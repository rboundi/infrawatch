import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';

const PAGES = [
  { name: '01-overview', path: '/' },
  { name: '02-hosts', path: '/hosts' },
  { name: '03-host-detail', path: null }, // click into first host
  { name: '04-alerts', path: '/alerts' },
  { name: '05-changes', path: '/changes' },
  { name: '06-eol', path: '/eol' },
  { name: '07-groups', path: '/groups' },
  { name: '08-dependencies', path: '/dependencies' },
  { name: '09-compliance', path: '/compliance' },
  { name: '10-discovery', path: '/discovery' },
  { name: '11-scan-targets', path: '/targets' },
  { name: '12-reports', path: '/reports' },
  { name: '13-notifications', path: '/settings/notifications' },
];

const BASE = 'http://localhost:5173';
const OUT = 'docs/screenshots';

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  for (const p of PAGES) {
    if (p.name === '03-host-detail') {
      // Navigate to hosts first, then click first row
      await page.goto(`${BASE}/hosts`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('table tbody tr', { timeout: 5000 });
      await page.click('table tbody tr');
      await page.waitForSelector('h2, h3', { timeout: 5000 });
      await new Promise(r => setTimeout(r, 1000));
    } else {
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
    }

    await page.screenshot({ path: `${OUT}/${p.name}.png`, fullPage: false });
    console.log(`Captured: ${p.name}`);
  }

  await browser.close();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
