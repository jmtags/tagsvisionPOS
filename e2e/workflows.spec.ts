import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
});
test.afterEach(() => expect(errors).toEqual([]));
async function navigate(page: import('@playwright/test').Page, name: string) {
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible())
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

test('copies an existing invoice into an editable draft without changing its history', async ({
  page,
}) => {
  test.setTimeout(90000);
  await navigate(page, 'Invoices');
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  await page.getByRole('button', { name: 'Copy invoice', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'New invoice', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Customer', exact: true })).toHaveValue('c1');
  await expect(dialog.getByLabel('Item 1 description')).toHaveValue('A4 color printing');
  await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('200');
  await expect(dialog.getByLabel('Unit price (PHP)', { exact: true })).toHaveValue('16');
  await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue('200 full-color flyers');
  await expect(dialog.getByLabel('Payment method')).toHaveValue('invoice');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  await expect(dialog.getByLabel('Issue date')).toHaveValue(today);
  await dialog.getByLabel('Item 1 description').fill('November campaign flyers');
  await dialog.getByLabel('Issue date').fill('2026-11-05');
  await dialog.getByLabel('Due date').fill('2026-11-20');
  await dialog.getByLabel('Discount (PHP)').fill('100');
  await dialog.getByLabel('Tax (%)', { exact: true }).fill('5');
  await dialog.getByLabel('Notes', { exact: true }).fill('Repeat order\nNew artwork');
  await dialog
    .getByLabel('Invoice terms', { exact: true })
    .fill('Approval required before printing.');
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByLabel('To', { exact: true }).fill('2026-11-30');
  await page.getByRole('button', { name: 'INV-000002', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('draft', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('November campaign flyers');
  await expect(dialog).toContainText('2026-11-05');
  await expect(dialog).toContainText('2026-11-20');
  await expect(dialog).toContainText('3,255.00');
  await expect(dialog).toContainText('Approval required before printing.');
  await expect(dialog).toContainText('No payments recorded.');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  const file = await download;
  await file.saveAs(`artifacts/${test.info().project.name}-copied-invoice.pdf`);
  const output = await readFile((await file.path())!, 'latin1');
  for (const text of [
    'November campaign flyers',
    'Approval required before printing.',
    'Repeat order',
    'New artwork',
  ])
    expect(output).toContain(text);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('200 full-color flyers');
  await expect(dialog).toContainText('Demo deposit');
  await expect(dialog).not.toContainText('November campaign flyers');
});

test('selects a paid invoice as a template, cancels safely and issues a fresh unpaid invoice with stock checks', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.getByRole('button', { name: 'New sale', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('c1');
  await dialog.getByRole('button', { name: /A4 Copy Paper/ }).click();
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Complete sale' }).click();
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Copy from invoice')
    .selectOption({ label: 'INV-000002 — Bright Future Studio (fictional)' });
  await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'INV-000003', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Item 1 description')).toHaveValue('');
  await dialog
    .getByLabel('Copy from invoice')
    .selectOption({ label: 'INV-000002 — Bright Future Studio (fictional)' });
  await dialog.getByLabel('Quantity', { exact: true }).fill('999');
  await dialog.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Insufficient stock');
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel('Invoice terms', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await page.getByRole('button', { name: 'INV-000003', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('pending', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('No payments recorded.');
  await expect(dialog.getByRole('region', { name: 'Invoice terms', exact: true })).toContainText(
    'No terms configured.',
  );
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'INV-000002', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('paid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await navigate(page, 'Inventory');
  await expect(
    page.getByRole('row').filter({ hasText: 'PPR-A4-80' }).getByRole('button', { name: '38 ream' }),
  ).toBeVisible();
});
test('navigation, search, customer creation and mobile overflow', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
  await navigate(page, 'Customers');
  await page.getByRole('button', { name: 'Add customer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Customer name').fill('New Demo Customer');
  await dialog.getByLabel('Email', { exact: true }).fill('new@example.test');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search records' }).fill('New Demo Customer');
  await expect(page.getByRole('cell', { name: 'New Demo Customer', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
test('complete sale deducts stock, creates a receipt and downloads PDF', async ({ page }) => {
  await page.getByRole('button', { name: 'New sale', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /A4 Copy Paper/ }).click();
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByRole('button', { name: 'INV-000002', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'INV-000002', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('paid', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('INV-000002.pdf');
  await file.saveAs(`artifacts/${test.info().project.name}-invoice.pdf`);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await navigate(page, 'Inventory');
  const row = page.getByRole('row').filter({ hasText: 'PPR-A4-80' });
  await expect(row.getByRole('button', { name: '40 ream' })).toBeVisible();
});
test('records a partial payment and keeps earlier payment history', async ({ page }) => {
  await navigate(page, 'Invoices');
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount (PHP)').fill('200');
  await page.getByLabel('Payment reference').fill('Second deposit');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('partially paid', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Demo deposit/)).toBeVisible();
  await expect(dialog.getByText(/Second deposit/)).toBeVisible();
});
test('dashboard and catalog screenshots', async ({ page }) => {
  await page.screenshot({
    path: `artifacts/${test.info().project.name}-dashboard.png`,
    fullPage: true,
  });
  await navigate(page, 'Inventory');
  await page.screenshot({
    path: `artifacts/${test.info().project.name}-inventory.png`,
    fullPage: true,
  });
});
test('administrator account forms validate password confirmation and mask passwords', async ({
  page,
}) => {
  await navigate(page, 'User management');
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('New Staff');
  await dialog.getByLabel('Email address').fill('staff@example.test');
  await dialog.getByLabel('Initial password').fill('Long-Staff-Password-2026');
  await dialog.getByLabel('Confirm password').fill('Different-Password-2026');
  await expect(dialog.getByLabel('Initial password')).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Passwords do not match');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('New password')).toHaveAttribute('type', 'password');
  await expect(dialog.getByLabel('Confirm password')).toHaveValue('');
});

test('saved logo and business details appear when creating, viewing and exporting invoices', async ({
  page,
}) => {
  test.setTimeout(90000);
  await navigate(page, 'Settings');
  const business = 'TagsVision Print Studio';
  const email = 'accounts@tagsvision.example';
  const phone = '0917 123 4567';
  const address = '123 Print Street, Quezon City';
  const terms = 'Please pay within 15 days. Thank you.';
  await page.getByLabel('Business name').fill(business);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Phone', { exact: true }).fill(phone);
  await page.getByLabel('Business address').fill(address);
  await page.getByLabel('Invoice terms / PDF footer').fill(terms);
  await page.getByLabel('PDF accent color').fill('#224488');
  const logo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#224488';
    context.fillRect(0, 0, 160, 80);
    context.fillStyle = '#ffffff';
    context.font = 'bold 32px sans-serif';
    context.fillText('TV', 50, 52);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'test-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(logo, 'base64'),
  });
  await expect(page.getByRole('img', { name: 'Shop logo preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await navigate(page, 'Invoices');
  await page.getByRole('button', { name: 'INV-000001', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const header = dialog.getByRole('region', { name: 'Invoice business details' });
  for (const text of [business, email, phone, address]) await expect(header).toContainText(text);
  await expect(header.getByRole('img', { name: `${business} logo` })).toBeVisible();
  await dialog.screenshot({ path: `artifacts/${test.info().project.name}-branded-invoice.png` });
  let download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  let file = await download;
  await file.saveAs(`artifacts/${test.info().project.name}-branded-existing-invoice.pdf`);
  let output = await readFile((await file.path())!, 'latin1');
  for (const text of [business, email, phone, address, 'PHP 3,200.00'])
    expect(output).toContain(text);
  expect(output).toContain('/Subtype /Image');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region', { name: 'Invoice business details' })).toContainText(
    business,
  );
  await expect(dialog.getByRole('img', { name: `${business} logo` })).toBeVisible();
  await expect(dialog.getByLabel('Invoice terms', { exact: true })).toHaveValue(terms);
  await dialog.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('c1');
  await dialog.getByLabel('Notes', { exact: true }).fill('Collect at reception.\nAsk for Jamie.');
  await dialog.getByRole('button', { name: /A4 Copy Paper/ }).click();
  await dialog.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await page.getByRole('button', { name: 'INV-000002', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText(terms, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Invoice notes' })).toContainText(
    'Collect at reception.',
  );
  await expect(dialog.getByRole('region', { name: 'Invoice notes' })).toContainText(
    'Ask for Jamie.',
  );
  await expect(dialog.getByRole('region', { name: 'Invoice notes' }).locator('p')).toHaveCSS(
    'white-space',
    'pre-line',
  );
  await expect(dialog.getByRole('region', { name: 'Invoice terms', exact: true })).toContainText(
    terms,
  );
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  file = await download;
  output = await readFile((await file.path())!, 'latin1');
  expect(output).toContain(business);
  expect(output).toContain(terms);
  expect(output).toContain('Collect at reception.');
  expect(output).toContain('Ask for Jamie.');
  expect(output).toContain('/Subtype /Image');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Remove logo', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await navigate(page, 'Invoices');
  await page.getByRole('button', { name: 'INV-000002', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('region', { name: 'Invoice business details' }).getByRole('img'),
  ).toHaveCount(0);
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  file = await download;
  expect(await readFile((await file.path())!, 'latin1')).not.toContain('/Subtype /Image');
});
