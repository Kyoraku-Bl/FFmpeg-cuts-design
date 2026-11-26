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

async function shot(name) {
  try {
    await dismissOverlays();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
    note('shot', name);
  } catch (e) { note('shot-error', `${name} ${e.message}`); }
}

async function visit(name, path) {
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1400);
    await dismissOverlays();
    note('visit', `${name} ${path} -> ${page.url()} (${r && r.status()})`);
    await shot(name);
  } catch (e) { note('visit-error', `${name} ${e.message}`); }
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
  note('login', `typed ${EMAIL}`);

  const submit = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    submit.click({ timeout: 10000 }),
  ]);
  await page.waitForTimeout(2500);
  await dismissOverlays();
  note('after-login-url', page.url());
  note('after-login-title', await page.title());
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
  note('after-login-body', bodyText.replace(/\n+/g, ' | '));
  await shot('02_after_login');
  note('logged-in', String(!/\/login|signup|forgot-password/.test(page.url())));

  // ---------------- real screens (tutorial dismissed) ----------------
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
  for (const [name, path] of pages) await visit(name, path);

  // ---------------- real transaction interaction ----------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissOverlays();

  // open the REAL "New transaction" modal (button, then N shortcut fallback)
  const newBtn = page.locator('button:has-text("New transaction")').first();
  if (await newBtn.count()) {
    await newBtn.click({ timeout: 6000 }).catch((e) => note('new-btn-error', e.message));
  } else {
    await page.keyboard.press('n').catch(() => {});
  }
  await page.waitForTimeout(1200);
  await dismissOverlays();
  note('modal-open-url', page.url());
  await shot('14_modal_open');

  const inputs = await page.locator('input:not([type="hidden"])').all();
  note('modal-inputs', String(inputs.length));
  const desc = page.locator('input[placeholder*="e.g."], input[placeholder*="Spotify"], input[placeholder*="escription"]').first();
  const amount = page.locator('input[placeholder="0.00"], input[inputmode="decimal"]').first();
  if (await desc.count()) { await desc.fill('Shopify payout — 7 days').catch(() => {}); note('fill', 'description ok'); }
  if (await amount.count()) { await amount.fill('4200').catch(() => {}); note('fill', 'amount ok'); }
  await page.waitForTimeout(600);
  await shot('15_modal_filled');

  // try to actually save, then capture the updated UI
  const save = page.locator('button:has-text("Save transaction"), button:has-text("Add transaction"), button:has-text("Save")').first();
  if (await save.count()) {
    await save.click({ timeout: 5000 }).catch((e) => note('save-error', e.message));
    await page.waitForTimeout(1600);
    await dismissOverlays();
    await shot('18_after_save');
    await visit('19_transactions_after', '/transactions');
  }

  // clean, unobstructed hero shots for the reel
  await visit('20_dashboard_clean', '/dashboard');
  await visit('21_transactions_clean', '/transactions');

  note('done', 'capture finished');
} catch (e) {
  note('fatal', e.message);
} finally {
  fs.writeFileSync(`${OUT}/manifest.txt`, log.join('\n') + '\n');
  await page.close().catch(() => {});
  await ctx.close().catch(() => {}); // finalizes the .webm
  await browser.close().catch(() => {});
}
