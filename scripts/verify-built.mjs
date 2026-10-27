import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const server = spawn(
  process.execPath,
  [
    resolve('node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '5174',
    '--strictPort',
  ],
  { stdio: 'ignore', windowsHide: true },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5174', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* wait for preview startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Production preview did not start. Run npm run build first.');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await page.getByRole('heading', { name: /Good/ }).waitFor();
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await mkdir('artifacts', { recursive: true });
  await (await download).saveAs('artifacts/production-invoice.pdf');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Invoices', exact: true }).click();
  for (const [button, extension] of [
    ['Export PDF', 'pdf'],
    ['Export Excel', 'xlsx'],
  ]) {
    const reportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await reportDownload).saveAs(`artifacts/production-invoice-list.${extension}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'Built app smoke test passed: login, demo dashboard, invoice detail, invoice PDF and table PDF/Excel downloads, no page errors.',
  );
} finally {
  await browser?.close();
  server.kill();
}
