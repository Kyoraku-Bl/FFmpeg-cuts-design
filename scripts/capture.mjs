/* Real Budgetly session capture — runs in GitHub Actions (full internet). */
import { chromium } from 'playwright';
import fs from 'node:fs';

const EMAIL = process.env.B_EMAIL || 'test1@hhh.fr';
const PASS = process.env.B_PASS || 'test1@hhh.fr';
const BASE = 'https://budgetly.online';
const OUT = 'footage';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(`${OUT}/video`, { recursive: true });

const log = [];
const note = (k, v) => { log.push(`${k}: ${v}`); console.log(`${k}: ${v}`); };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  colorScheme: 'light',
  recordVideo: { dir: `${OUT}/video`, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

async function dismissOverlays() {
  for (let i = 0; i < 5; i++) {
    const skip = page.getByText(/skip tutorial/i);
    if (await skip.count()) {
      await skip.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    const close = page.locator('button[aria-label="Close"], button:has-text("✕"), button:has-text("X")');
    if (await close.count()) {
      await close.first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(350);
      continue;
    }
    const consent = page.getByText(/^Essential only$/i);
    if (await consent.count()) {
      await consent.first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    const consent2 = page.getByText(/accept all|got it|accept analytics/i);
    if (await consent2.count()) {
      await consent2.first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(350);
      continue;
    }
    break;
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function shot(name, dismiss = true) {
  try {
    if (dismiss) await dismissOverlays();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
    note('shot', name);
  } catch (e) { note('shot-error', `${name} ${e.message}`); }
}

async function visit(name, path, dismiss = true) {
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1400);
    if (dismiss) await dismissOverlays();
    note('visit', `${name} ${path} -> ${page.url()} (${r && r.status()})`);
    await shot(name, false);
  } catch (e) { note('visit-error', `${name} ${e.message}`); }
}

function clean(s, n = 700) {
  return String(s || '').replace(/\n+/g, ' | ').slice(0, n);
}

try {
  // ---------------- login ----------------
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot('00_login');
  const emailSel = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
  const passSel = page.locator('input[type="password"]').first();
  await emailSel.fill(EMAIL, { timeout: 10000 });
  await passSel.fill(PASS, { timeout: 10000 });
  await shot('01_login_filled');
  note('login', 'typed supplied test account');
  const submit = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    submit.click({ timeout: 10000 }),
  ]);
  await page.waitForTimeout(2500);
  await dismissOverlays();
  note('after-login-url', page.url());
  note('after-login-title', await page.title());
  note('after-login-body', clean(await page.locator('body').innerText().catch(() => ''), 500));
  await shot('02_after_login');
  note('logged-in', String(!/\/login|signup|forgot-password/.test(page.url())));

  // ---------------- real screens ----------------
  const pages = [
    ['03_dashboard', '/dashboard'],
    ['04_overview', '/overview'],
    ['05_transactions', '/transactions'],
    ['06_new_transaction', '/dashboard?new=1'],
    ['07_month', '/month'],
    ['08_accounts', '/accounts'],
    ['09_goals', '/goals'],
    ['10_reports', '/reports'],
    ['11_compare', '/compare'],
    ['12_businesses', '/businesses'],
    ['13_settings', '/settings'],
    ['16_demo', '/demo'],
    ['17_pricing', '/pricing'],
  ];
  for (const [name, path] of pages) await visit(name, path, name !== '06_new_transaction');

  // ---------------- clean BEFORE state ----------------
  await visit('20_dashboard_clean', '/dashboard');

  // ---------------- real transaction interaction ----------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissOverlays();

  // Prefer the real N shortcut; fall back to the New transaction button.
  await page.keyboard.press('n').catch(() => {});
  await page.waitForTimeout(900);
  const modalHint = page.getByText('Record money coming in or going out.').first();
  let openMethod = 'N shortcut';
  if (!(await modalHint.count())) {
    const newBtn = page.locator('button:has-text("New transaction")').first();
    if (await newBtn.count()) {
      await newBtn.click({ timeout: 6000 }).catch((e) => note('new-btn-error', e.message));
      openMethod = 'New transaction button';
    }
  }
  await page.waitForTimeout(1000);
  note('modal-open-method', openMethod);
  note('modal-open-url', page.url());
  await shot('14_modal_open', false);

  const inputs = await page.locator('input:not([type="hidden"])').all();
  note('modal-inputs', String(inputs.length));
  const noteInput = page.locator('input[placeholder*="e.g."], input[placeholder*="Spotify"], input[placeholder*="escription"]').first();
  const amount = page.locator('input[placeholder="0.00"], input[inputmode="decimal"]').first();
  if (await noteInput.count()) { await noteInput.fill('Shopify payout — 7 days').catch(() => {}); note('fill', 'note ok'); }
  if (await amount.count()) { await amount.fill('4200').catch(() => {}); note('fill', 'amount ok'); }

  // Select Wise so the account balance / dashboard cards really move.
  let accountSelected = false;
  const selects = await page.locator('select').all();
  note('select-count', String(selects.length));
  for (let i = 0; i < selects.length; i++) {
    const opts = await selects[i].locator('option').allTextContents();
    note(`select-${i}`, opts.join(' | ').slice(0, 260));
    const wi = opts.findIndex((o) => /wise/i.test(o));
    if (wi >= 0) {
      await selects[i].selectOption({ index: wi }).catch((e) => note('account-select-error', e.message));
      note('account-selected', `native select ${i}: ${opts[wi]}`);
      accountSelected = true;
      break;
    }
  }
  if (!accountSelected) {
    const trigger = page.locator('button:has-text("No account"), [role="combobox"]:has-text("No account")').first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(450);
      const opts = await page.locator('[role="option"], li').allTextContents();
      note('account-options', opts.join(' | ').slice(0, 300));
      const wise = page.getByRole('option', { name: /Wise/i }).first();
      if (await wise.count()) {
        await wise.click({ timeout: 4000 }).catch(() => {});
        note('account-selected', 'custom option Wise');
        accountSelected = true;
      } else {
        const wise2 = page.locator('button:has-text("Wise"), li:has-text("Wise"), [role="option"]:has-text("Wise")').first();
        if (await wise2.count()) {
          await wise2.click({ timeout: 4000 }).catch(() => {});
          note('account-selected', 'custom fallback Wise');
          accountSelected = true;
        }
      }
    }
  }
  note('account-selected-final', String(accountSelected));
  await page.waitForTimeout(600);
  await shot('15_modal_filled', false);

  // Click the REAL Add expense button, then capture the updated UI.
  const buttons = await page.locator('button').allTextContents();
  note('modal-buttons', buttons.filter((t) => /expense|save|add transaction|cancel/i.test(t)).join(' | ').slice(0, 260));
  const save = page.locator('button:has-text("Add expense"), button:has-text("Save transaction"), button:has-text("Add transaction"), button:has-text("Save")').first();
  if (await save.count()) {
    await save.click({ timeout: 6000 }).catch((e) => note('save-error', e.message));
    await page.waitForTimeout(2200);
    note('after-save-url', page.url());
    note('modal-after-save', String(await modalHint.count()));
    note('after-save-body', clean(await page.locator('body').innerText().catch(() => ''), 900));
    await shot('18_after_save', false);
    await visit('19_transactions_after', '/transactions');
  } else {
    note('save-error', 'no save button found');
  }

  // Clean AFTER state: transactions page with the new row.
  if (fs.existsSync(`${OUT}/19_transactions_after.png`)) {
    fs.copyFileSync(`${OUT}/19_transactions_after.png`, `${OUT}/21_transactions_clean.png`);
    note('shot', '21_transactions_clean');
  } else {
    await visit('21_transactions_clean', '/transactions');
  }

  note('done', 'capture finished');
} catch (e) {
  note('fatal', e.message);
} finally {
  fs.writeFileSync(`${OUT}/manifest.txt`, log.join('\n') + '\n');
  await page.close().catch(() => {});
  await ctx.close().catch(() => {}); // finalizes the .webm
  await browser.close().catch(() => {});
}
