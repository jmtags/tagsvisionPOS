import { describe, expect, it } from 'vitest';
import { balanceDue, can, invoiceStatus, paidAmount, totals } from './domain';
import type { Line, Payment, Role } from './domain';
const lines: Line[] = [
  { product_id: null, description: 'Color print', quantity: 3, unit_price: 16.35 },
  { product_id: null, description: 'Paper', quantity: 2, unit_price: 24.12 },
];
describe('invoice totals', () => {
  it('rounds each line to cents before discount and configurable tax', () => {
    expect(totals(lines, 7.29, 12)).toEqual({ subtotal: 97.29, tax: 10.8, total: 100.8 });
  });
  it('does not assume VAT', () => expect(totals(lines).total).toBe(97.29));
  it('rounds fractional units consistently with PostgreSQL', () =>
    expect(
      totals([{ product_id: null, description: 'Material', quantity: 1.005, unit_price: 1 }]).total,
    ).toBe(1.01));
  it.each([-1, 98, NaN, Infinity])('rejects invalid discounts %s', (d) =>
    expect(() => totals(lines, d)).toThrow(),
  );
  it('rejects missing descriptions, empty items and negative quantity', () => {
    expect(() => totals([])).toThrow();
    expect(() => totals([{ ...lines[0], quantity: -1 }])).toThrow();
    expect(() => totals([{ ...lines[0], description: ' ' }])).toThrow();
  });
});
describe('payment ledger and status transitions', () => {
  const i = { status: 'pending' as const, total: 100, due_date: '2026-10-30' };
  it('tracks partial and full collections without replacing previous records', () => {
    const payments: Payment[] = [];
    const add = (amount: number, id = 'invoice') =>
      payments.push({
        id: String(payments.length),
        invoice_id: id,
        amount,
        method: 'cash',
        reference: '',
        created_at: '2026-10-22',
      });
    expect(invoiceStatus(i, 0, '2026-10-22')).toBe('pending');
    add(25);
    expect(invoiceStatus(i, paidAmount('invoice', payments), '2026-10-22')).toBe('partially paid');
    add(75);
    add(400, 'another');
    expect(invoiceStatus(i, paidAmount('invoice', payments), '2026-10-22')).toBe('paid');
    expect(payments).toHaveLength(3);
  });
  it('derives overdue at read time, including partial balances', () => {
    expect(invoiceStatus(i, 20, '2026-10-31')).toBe('overdue');
    expect(invoiceStatus(i, 0, '2026-10-30')).toBe('pending');
    expect(invoiceStatus(i, 100, '2026-10-31')).toBe('paid');
  });
  it('preserves draft and void states', () => {
    expect(invoiceStatus({ ...i, status: 'draft' }, 0)).toBe('draft');
    expect(invoiceStatus({ ...i, status: 'void' }, 100)).toBe('void');
  });
  it('settles zero-total invoices', () =>
    expect(invoiceStatus({ ...i, total: 0 }, 0)).toBe('paid'));
  it('retains an exact final cent balance after decimal payments', () => {
    const payments = [0.1, 0.2].map((amount, index) => ({
      id: String(index),
      invoice_id: 'i',
      amount,
      method: 'cash',
      reference: '',
      created_at: '2026-10-22',
    }));
    expect(paidAmount('i', payments)).toBe(0.3);
    expect(balanceDue({ id: 'i', total: 0.4 }, payments)).toBe(0.1);
  });
});
describe('UI role authorization', () => {
  it.each(['Administrator', 'Cashier', 'Staff', 'Accountant'] as Role[])(
    'limits administrative controls for %s',
    (role) => expect(can(role, 'admin')).toBe(role === 'Administrator'),
  );
  it('keeps stock adjustments with staff and finance with accountants', () => {
    expect(can('Staff', 'inventory')).toBe(true);
    expect(can('Cashier', 'inventory')).toBe(false);
    expect(can('Staff', 'pay')).toBe(false);
    expect(can('Accountant', 'expense')).toBe(true);
    expect(can('Cashier', 'expense')).toBe(false);
  });
});
