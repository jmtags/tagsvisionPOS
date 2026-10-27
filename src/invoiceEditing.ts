import { invoiceEditable, invoiceStatus, paidAmount, totals } from './domain';
import type { Data, Invoice, Line } from './domain';

// Demo mirrors the production RPC. Real edits always run through edit_invoice in PostgreSQL.
export function editDemoInvoice(
  data: Data,
  source: Invoice,
  payload: Record<string, unknown>,
  actor: string,
): Data {
  const next = structuredClone(data);
  const invoice = next.invoices.find((i) => i.id === source.id);
  if (!invoice || !invoiceEditable(invoice, data.payments))
    throw new Error('Completed or void invoices cannot be edited.');
  if ((invoice.revision ?? 1) !== (source.revision ?? 1))
    throw new Error('This invoice has changed. Reload and try again.');
  const lines = payload.lines as Line[];
  const calc = totals(lines, Number(payload.discount), Number(payload.tax_rate));
  const paid = paidAmount(invoice.id, data.payments);
  if (calc.total < paid)
    throw new Error('Invoice total cannot be less than payments already received.');
  const customerId = String(payload.customer_id || '') || null;
  if (paid > 0 && customerId !== invoice.customer_id)
    throw new Error('Customer cannot change after payments have been received.');
  if (invoice.status !== 'draft' && !customerId)
    throw new Error('Credit invoices require a customer.');
  if (String(payload.due_date) < String(payload.issue_date))
    throw new Error('Due date cannot be earlier than issue date.');
  if (customerId !== invoice.customer_id) {
    const customer = next.customers.find((c) => c.id === customerId && c.active);
    if (customerId && !customer) throw new Error('Choose an active customer.');
    invoice.customer_id = customerId;
    invoice.customer_name = customer?.name || 'Walk-in customer';
    invoice.customer_email = customer?.email || '';
    invoice.billing_address = customer?.billing_address || '';
  }
  for (const line of lines) {
    if (line.product_id && !next.products.some((p) => p.id === line.product_id))
      throw new Error('Catalog item unavailable.');
  }
  if (invoice.status !== 'draft') {
    for (const product of next.products) {
      const wanted = lines
        .filter((l) => l.product_id === product.id)
        .reduce((sum, l) => sum + Number(l.quantity), 0);
      if (wanted && !product.active) throw new Error(`Product is inactive: ${product.name}`);
      if (!product.track_stock) continue;
      const deducted = -next.stock_movements
        .filter((m) => m.invoice_id === invoice.id && m.product_id === product.id)
        .reduce((sum, m) => sum + Number(m.delta), 0);
      const delta = Math.round((deducted - wanted) * 1000) / 1000;
      if (Number(product.quantity) + delta < 0)
        throw new Error(`Insufficient stock: ${product.name}`);
      if (delta) {
        product.quantity = Math.round((Number(product.quantity) + delta) * 1000) / 1000;
        next.stock_movements.push({
          id: crypto.randomUUID(),
          product_id: product.id,
          invoice_id: invoice.id,
          delta,
          reason: `Edit ${invoice.number} revision ${(invoice.revision ?? 1) + 1}`,
          created_by: actor,
          created_at: new Date().toISOString(),
        });
      }
    }
  }
  next.invoice_items = next.invoice_items.filter((l) => l.invoice_id !== invoice.id);
  next.invoice_items.push(
    ...lines.map((l) => ({ ...l, id: crypto.randomUUID(), invoice_id: invoice.id })),
  );
  Object.assign(invoice, {
    subtotal: calc.subtotal,
    total: calc.total,
    discount: Number(payload.discount),
    tax_rate: Number(payload.tax_rate),
    issue_date: String(payload.issue_date),
    due_date: String(payload.due_date),
    notes: String(payload.notes ?? invoice.notes),
    terms: String(payload.terms ?? invoice.terms),
    terms_customized: payload.terms != null || invoice.terms_customized,
    revision: (invoice.revision ?? 1) + 1,
  });
  invoice.status = invoiceStatus(invoice, paid);
  for (const sale of next.sales.filter((s) => s.invoice_id === invoice.id)) {
    sale.total = calc.total;
    sale.customer_id = customerId;
  }
  return next;
}
