import { test, expect } from '@playwright/test';
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
