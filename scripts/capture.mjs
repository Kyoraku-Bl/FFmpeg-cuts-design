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

async function shot(name) {
  try {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
    note('shot', name);
  } catch (e) { note('shot-error', `${name} ${e.message}`); }
}

async function visit(name, path) {
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1400);
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
  note('after-login-url', page.url());
  note('after-login-title', await page.title());
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
  note('after-login-body', bodyText.replace(/\n+/g, ' | '));
  await shot('02_after_login');

  const loggedIn = !/\/login|signup|forgot-password/.test(page.url());
  note('logged-in', String(loggedIn));

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
  ];
  for (const [name, path] of pages) await visit(name, path);

  // ---------------- real transaction interaction ----------------
  await page.goto(`${BASE}/dashboard?new=1`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot('14_modal_open');
  const inputs = await page.locator('input').all();
  note('modal-inputs', String(inputs.length));
  for (let i = 0; i < inputs.length; i++) {
    const t = await inputs[i].getAttribute('type').catch(() => '');
    const ph = await inputs[i].getAttribute('placeholder').catch(() => '');
    const nm = await inputs[i].getAttribute('name').catch(() => '');
    note(`input-${i}`, `${t || 'text'} name=${nm} placeholder=${ph}`);
  }
  // best-effort: fill a description + amount
  const desc = page.locator('input[name="description"], input[placeholder*="escription"], input[placeholder*="e.g."]').first();
  const amount = page.locator('input[name="amount"], input[inputmode="decimal"], input[placeholder*="0.00"]').first();
  if (await desc.count()) { await desc.fill('Shopify payout — 7 days').catch(() => {}); note('fill', 'description ok'); }
  if (await amount.count()) { await amount.fill('4200').catch(() => {}); note('fill', 'amount ok'); }
  await shot('15_modal_filled');

  // ---------------- public demo too ----------------
  await visit('16_demo', '/demo');
  await visit('17_pricing', '/pricing');

  note('done', 'capture finished');
} catch (e) {
  note('fatal', e.message);
} finally {
  fs.writeFileSync(`${OUT}/manifest.txt`, log.join('\n') + '\n');
  await page.close().catch(() => {});
  await ctx.close().catch(() => {}); // finalizes the .webm
  await browser.close().catch(() => {});
}
