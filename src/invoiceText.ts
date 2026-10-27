import type { Invoice, Settings } from './domain';

// Preserve agreed terms; invoices created before terms were configured use the shop default.
export function invoiceText(invoice: Invoice, settings: Settings) {
  return {
    notes: invoice.notes?.trim() || '',
    terms: invoice.terms?.trim() || settings.terms?.trim() || '',
  };
}
