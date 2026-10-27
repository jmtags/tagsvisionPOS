import { describe, expect, it } from 'vitest';
import { demoData, demoSettings } from './demo';
import { invoicePdf } from './pdf';
import { invoiceText } from './invoiceText';

describe('invoice business details in exported PDFs', () => {
  it('preserves terms intentionally cleared on a new or copied invoice', () => {
    const data = demoData();
    const invoice = { ...data.invoices[0], terms: '', terms_customized: true };
    expect(invoiceText(invoice, demoSettings).terms).toBe('');
    expect(invoicePdf(invoice, data.invoice_items, [], demoSettings).output()).not.toContain(
      demoSettings.terms,
    );
  });
  it('uses configured terms for older blank invoices without changing the saved record', () => {
    const data = demoData();
    const invoice = {
      ...data.invoices[0],
      notes: 'Collect at reception.\nAsk for Jamie.',
      terms: '  ',
    };
    const settings = { ...demoSettings, terms: 'Payment within 15 days.\nKeep this invoice.' };
    expect(invoiceText(invoice, settings)).toEqual({
      notes: invoice.notes,
      terms: settings.terms,
    });
    const output = invoicePdf(invoice, data.invoice_items, [], settings).output();
    for (const text of [
      'Notes',
      'Collect at reception.',
      'Ask for Jamie.',
      'Terms & conditions',
      'Payment within 15 days.',
      'Keep this invoice.',
    ])
      expect(output).toContain(text);
    expect(invoice.terms).toBe('  ');
  });
  it('does not export undefined values or empty text sections on legacy records', () => {
    const data = demoData();
    const invoice = {
      ...data.invoices[0],
      notes: undefined,
      terms: undefined,
    } as unknown as (typeof data.invoices)[0];
    const output = invoicePdf(invoice, data.invoice_items, [], {
      ...demoSettings,
      terms: '',
    }).output();
    expect(output).not.toContain('(undefined)');
    expect(output).not.toContain('(Notes)');
    expect(output).not.toContain('(Terms & conditions)');
  });
  it('exports all multiline notes and long terms across pages', () => {
    const data = demoData();
    const invoice = {
      ...data.invoices[0],
      notes: 'First note.\nSecond note.',
      terms: Array.from(
        { length: 100 },
        (_, i) => `Clause ${i + 1}: Please retain proof of payment.`,
      ).join('\n'),
    };
    const doc = invoicePdf(invoice, data.invoice_items, [], demoSettings);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const output = doc.output();
    for (const text of ['First note.', 'Second note.', 'Clause 1:', 'Clause 100:'])
      expect(output).toContain(text);
  });
  it('uses current saved shop identity on reprints even when the invoice snapshot predates it', () => {
    const data = demoData();
    const invoice = data.invoices[0];
    const settings = {
      ...demoSettings,
      business_name: 'TagsVision Print Studio',
      email: 'billing@example.test',
      phone: '0917 123 4567',
      address: '123 Print Street',
      brand_color: '#123456',
    };
    const output = invoicePdf(invoice, data.invoice_items, data.payments, settings).output();
    for (const text of [
      settings.business_name,
      settings.email,
      settings.phone,
      settings.address,
      'Bright Future Studio',
      'PHP 3,200.00',
      'PHP 1,000.00',
      'PHP 2,200.00',
      invoice.terms,
    ])
      expect(output).toContain(text);
    expect(output).not.toContain('Fictional Print Lane');
    expect(invoice.business_details?.business_name).toBe('Press & Paper');
  });
  it('honors removed branding and contacts instead of reviving them from an old invoice', () => {
    const data = demoData();
    const invoice = data.invoices[0];
    invoice.business_details = {
      ...demoSettings,
      logo_url: 'data:image/png;base64,invalid-old-logo',
      email: 'old@example.test',
      phone: 'Old phone',
      address: 'Old address',
    };
    const output = invoicePdf(invoice, data.invoice_items, [], {
      ...demoSettings,
      logo_url: '',
      email: '',
      phone: '',
      address: '',
    }).output();
    expect(output).not.toContain('/Subtype /Image');
    expect(output).not.toContain('old@example.test');
    expect(output).not.toContain('Old address');
  });
  it('does not replace historical invoice terms or tax when shop defaults change', () => {
    const data = demoData();
    const invoice = data.invoices[0];
    const output = invoicePdf(invoice, data.invoice_items, [], {
      ...demoSettings,
      terms: 'New terms for future invoices only',
      tax_rate: 12,
      tax_label: 'New default tax',
    }).output();
    expect(output).toContain(invoice.terms);
    expect(output).not.toContain('New terms for future invoices only');
    expect(output).toContain('Tax \\(0%\\)');
    expect(invoice.tax_rate).toBe(0);
  });
  it('renders the same business details for invoices without a legacy snapshot', () => {
    const data = demoData();
    delete data.invoices[0].business_details;
    expect(invoicePdf(data.invoices[0], data.invoice_items, [], demoSettings).output()).toContain(
      demoSettings.business_name,
    );
  });
});
