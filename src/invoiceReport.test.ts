import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { demoData, demoSettings } from './demo';
import { createInvoiceReport } from './invoiceReport';
import { invoiceTableExcel, invoiceTablePdf } from './invoiceTableExport';

const filters = { from: '2026-10-01', to: '2026-10-31', search: '', status: 'all' };

describe('invoice list totals and exports', () => {
  it('sums cents exactly and preserves partial-payment balances on the supplied matching rows', () => {
    const data = demoData();
    const invoices = [
      { ...data.invoices[0], total: 3200.1 },
      {
        ...data.invoices[0],
        id: 'second',
        number: 'INV-000002',
        total: 100.2,
        status: 'draft' as const,
      },
    ];
    const report = createInvoiceReport(invoices, data.payments, filters);
    expect(report.total).toBe(3300.3);
    expect(report.balance).toBe(2300.3);
    expect(report.rows[0].balance).toBe(2200.1);
    expect(report.rows[1].status).toBe('draft');
    expect(createInvoiceReport([], data.payments, filters)).toMatchObject({
      rows: [],
      total: 0,
      balance: 0,
    });
  });

  it('includes all matching rows beyond the display limit and prints totals once on the final PDF page', () => {
    const data = demoData();
    const invoices = Array.from({ length: 45 }, (_, i) => ({
      ...data.invoices[0],
      id: `report-${i}`,
      number: `INV-${String(i + 1).padStart(6, '0')}`,
      total: 10.25,
      notes: 'Print job notes\nCollection at reception.',
    }));
    const report = createInvoiceReport(invoices, [], filters);
    expect(report.rows).toHaveLength(45);
    expect(report.total).toBe(461.25);
    expect(report.balance).toBe(461.25);
    const pdf = invoiceTablePdf(report, demoSettings);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    const output = pdf.output();
    expect(output).toContain('INV-000045');
    expect(output).toContain('PHP 461.25');
    expect(output.split('Totals \\(45 invoices\\)').length - 1).toBe(1);
    expect(output).toContain('2026-10-01');
    expect(output).toContain('Collection at reception.');
  });

  it('exports a real workbook with numeric totals, escaped text and no formulas from user input', async () => {
    const data = demoData();
    const invoice = {
      ...data.invoices[0],
      customer_name: '=SUM(1,2)',
      notes: '<Print & collect>\nSecond line',
    };
    const report = createInvoiceReport([invoice], data.payments, { ...filters, search: '=SUM' });
    const blob = await invoiceTableExcel(report, demoSettings);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const strings = strFromU8(files['xl/sharedStrings.xml']);
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Invoices"');
    expect(sheet).toMatch(/<c r="F4"[^>]*><v>3200<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="G4"[^>]*><v>2200<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="F5"[^>]*><v>3200<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="G5"[^>]*><v>2200<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="B4"[^>]*t="s"/);
    expect(sheet).not.toContain('<f');
    expect(strings).toContain('=SUM(1,2)');
    expect(strings).toContain('&lt;Print &amp; collect&gt;');
    expect(strings).toContain('Search: =SUM');
    expect(sheet).toContain('ySplit="3"');
  });
});
