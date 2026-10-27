import { describe, expect, it } from 'vitest';
import { demoData, demoSettings } from './demo';
import { invoicePdf } from './pdf';

describe('invoice business details in exported PDFs', () => {
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
