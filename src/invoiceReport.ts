import { balanceDue, invoiceStatus, paidAmount } from './domain';
import type { Invoice, Payment } from './domain';

export interface InvoiceReportFilters {
  from: string;
  to: string;
  search: string;
  status: string;
}
export interface InvoiceReport {
  filters: InvoiceReportFilters;
  rows: {
    number: string;
    customer: string;
    notes: string;
    issueDate: string;
    dueDate: string;
    total: number;
    balance: number;
    status: string;
  }[];
  total: number;
  balance: number;
}

// The caller supplies all matching invoices, before the UI's Show more limit.
export function createInvoiceReport(
  invoices: Invoice[],
  payments: Payment[],
  filters: InvoiceReportFilters,
): InvoiceReport {
  const rows = invoices.map((i) => ({
    number: i.number,
    customer: i.customer_name,
    notes: i.notes?.trim() || '',
    issueDate: i.issue_date,
    dueDate: i.due_date,
    total: Number(i.total),
    balance: balanceDue(i, payments),
    status: invoiceStatus(i, paidAmount(i.id, payments)),
  }));
  return {
    filters: { ...filters },
    rows,
    total: rows.reduce((sum, row) => sum + Math.round(row.total * 100), 0) / 100,
    balance: rows.reduce((sum, row) => sum + Math.round(row.balance * 100), 0) / 100,
  };
}

export const reportHeaders = [
  'Invoice',
  'Customer',
  'Notes',
  'Issue date',
  'Due date',
  'Total (PHP)',
  'Balance (PHP)',
  'Status',
];
export const reportScope = (report: InvoiceReport) =>
  `Issued ${report.filters.from} to ${report.filters.to} | Status: ${report.filters.status === 'all' ? 'All' : report.filters.status} | Search: ${report.filters.search || 'None'} | ${report.rows.length} matching ${report.rows.length === 1 ? 'invoice' : 'invoices'}`;
