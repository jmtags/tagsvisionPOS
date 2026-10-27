export type Role = 'Administrator' | 'Cashier' | 'Staff' | 'Accountant';
export type Status = 'draft' | 'pending' | 'partially paid' | 'paid' | 'overdue' | 'void';
export type Method = 'cash' | 'gcash' | 'bank transfer' | 'invoice';
export interface Profile {
  id: string;
  shop_id: string;
  display_name: string;
  email: string;
  role: Role;
  active: boolean;
}
export interface Customer {
  id: string;
  shop_id: string;
  name: string;
  email: string;
  phone: string;
  billing_address: string;
  notes: string;
  active: boolean;
}
export interface Product {
  id: string;
  shop_id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: number;
  cost: number;
  quantity: number;
  reorder_threshold: number;
  track_stock: boolean;
  active: boolean;
}
export interface Line {
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
}
export interface Invoice {
  id: string;
  shop_id: string;
  number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  billing_address: string;
  business_details?: Settings;
  issue_date: string;
  due_date: string;
  discount: number;
  tax_rate: number;
  tax_label: string;
  subtotal: number;
  total: number;
  status: Status;
  notes: string;
  terms: string;
  terms_customized?: boolean;
  created_at: string;
}
export interface InvoiceItem extends Line {
  id: string;
  invoice_id: string;
}
export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  reference: string;
  created_at: string;
}
export interface Sale {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  total: number;
  method: Method;
  created_at: string;
  status: string;
}
export interface Expense {
  id: string;
  shop_id: string;
  description: string;
  category_id: string;
  vendor: string;
  amount: number;
  expense_date: string;
  notes: string;
  receipt_reference: string;
  created_by: string;
  status: string;
}
export interface Category {
  id: string;
  name: string;
}
export interface Movement {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  created_at: string;
  created_by: string;
}
export interface Settings {
  shop_id: string;
  business_name: string;
  email: string;
  phone: string;
  address: string;
  logo_url: string;
  currency: string;
  invoice_prefix: string;
  payment_terms_days: number;
  tax_rate: number;
  tax_label: string;
  terms: string;
  brand_color: string;
  timezone: string;
}
export interface Data {
  profiles: Profile[];
  customers: Customer[];
  products: Product[];
  invoices: Invoice[];
  invoice_items: InvoiceItem[];
  payments: Payment[];
  sales: Sale[];
  expenses: Expense[];
  expense_categories: Category[];
  stock_movements: Movement[];
  shop_settings: Settings[];
}
export const emptyData: Data = {
  profiles: [],
  customers: [],
  products: [],
  invoices: [],
  invoice_items: [],
  payments: [],
  sales: [],
  expenses: [],
  expense_categories: [],
  stock_movements: [],
  shop_settings: [],
};
export const money = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const lineAmount = (quantity: number, price: number) =>
  Math.round((Math.round(quantity * 1000) * Math.round(price * 100)) / 1000) / 100;
export function totals(lines: Line[], discount = 0, taxRate = 0) {
  if (
    !lines.length ||
    lines.some(
      (l) =>
        !l.description.trim() ||
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        !Number.isFinite(l.unit_price) ||
        l.unit_price < 0,
    )
  )
    throw new Error('Add valid items with a positive quantity and nonnegative price.');
  if (
    lines.some(
      (l) =>
        Math.abs(l.quantity * 1000 - Math.round(l.quantity * 1000)) > 0.00001 ||
        Math.abs(l.unit_price * 100 - Math.round(l.unit_price * 100)) > 0.00001,
    )
  )
    throw new Error('Use at most 3 decimal places for quantities and 2 for prices.');
  const subtotal = lines.reduce(
    (s, l) => s + Math.round(lineAmount(l.quantity, l.unit_price) * 100),
    0,
  );
  const cents = Math.round(discount * 100);
  if (
    !Number.isSafeInteger(subtotal) ||
    !Number.isFinite(discount) ||
    cents < 0 ||
    cents > subtotal ||
    !Number.isFinite(taxRate) ||
    taxRate < 0 ||
    taxRate > 100 ||
    Math.abs(discount * 100 - cents) > 0.00001 ||
    Math.abs(taxRate * 100 - Math.round(taxRate * 100)) > 0.00001
  )
    throw new Error('Check discount and tax rate.');
  const tax = Math.round(((subtotal - cents) * Math.round(taxRate * 100)) / 10000);
  return { subtotal: subtotal / 100, tax: tax / 100, total: (subtotal - cents + tax) / 100 };
}
export function invoiceStatus(
  invoice: Pick<Invoice, 'status' | 'total' | 'due_date'>,
  paid: number,
  date = today(),
): Status {
  if (invoice.status === 'void' || invoice.status === 'draft') return invoice.status;
  if (Math.round(paid * 100) >= Math.round(invoice.total * 100)) return 'paid';
  if (invoice.due_date < date) return 'overdue';
  return paid > 0 ? 'partially paid' : 'pending';
}
export const paidAmount = (id: string, payments: Payment[]) =>
  payments
    .filter((p) => p.invoice_id === id)
    .reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0) / 100;
export const balanceDue = (invoice: Pick<Invoice, 'id' | 'total'>, payments: Payment[]) =>
  Math.max(
    0,
    Math.round(Number(invoice.total) * 100) - Math.round(paidAmount(invoice.id, payments) * 100),
  ) / 100;
export type Action = 'sell' | 'invoice' | 'pay' | 'expense' | 'inventory' | 'customer' | 'admin';
export function can(role: Role, action: Action) {
  return (
    role === 'Administrator' ||
    (
      {
        sell: ['Cashier'],
        invoice: ['Cashier', 'Accountant'],
        pay: ['Cashier', 'Accountant'],
        expense: ['Accountant'],
        inventory: ['Staff'],
        customer: ['Cashier', 'Staff', 'Accountant'],
        admin: [],
      }[action] as string[]
    ).includes(role)
  );
}
