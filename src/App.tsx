import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  LayoutDashboard,
  ShoppingBag,
  FileText,
  ArrowUpRight,
  Package,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  Printer,
  Plus,
  Search,
  Download,
  Share2,
  ChevronRight,
  X,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from './client';
import {
  balanceDue,
  can,
  emptyData,
  invoiceStatus,
  lineAmount,
  money,
  paidAmount,
  today,
  totals,
} from './domain';
import type {
  Customer,
  Data,
  Expense,
  Invoice,
  Line,
  Product,
  Profile,
  Role,
  Settings,
} from './domain';
import { demoData, demoSettings } from './demo';
import { Badge, Empty, Field, Modal, Stat } from './components';
import { invoicePdf, shareInvoice } from './pdf';
import { InvoiceBranding } from './InvoiceBranding';

type Page =
  | 'dashboard'
  | 'sales'
  | 'invoices'
  | 'expenses'
  | 'inventory'
  | 'customers'
  | 'users'
  | 'settings';
const navigation: { id: Page; name: string; icon: typeof Menu }[] = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
  { id: 'sales', name: 'Sales', icon: ShoppingBag },
  { id: 'invoices', name: 'Invoices', icon: FileText },
  { id: 'expenses', name: 'Expenses', icon: ArrowUpRight },
  { id: 'inventory', name: 'Inventory', icon: Package },
  { id: 'customers', name: 'Customers', icon: Users },
  { id: 'users', name: 'User management', icon: ShieldCheck },
  { id: 'settings', name: 'Settings', icon: SettingsIcon },
];
const descriptions: Record<Page, string> = {
  dashboard: 'A clear view of your shop, all in one place.',
  sales: 'Record walk-in sales and create customer orders.',
  invoices: 'Create and keep track of customer invoices.',
  expenses: 'Keep everyday business costs in order.',
  inventory: 'Monitor stock levels, product costs, and pricing.',
  customers: 'Your customers, orders, and billing details.',
  users: 'Manage your team and their access.',
  settings: 'Make your shop feel like yours.',
};
type Edit = {
  kind:
    'customer' | 'product' | 'expense' | 'adjust' | 'invite' | 'password' | 'payment' | 'category';
  record?: Customer | Product | Expense | Invoice | Profile;
};
const errText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === 'object' && e && 'message' in e
      ? String(e.message)
      : 'Something went wrong. Please try again.';
function formValues(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
}
const uid = () => crypto.randomUUID();
const datePlus = (days: number) => {
  const d = new Date(`${today()}T12:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(!supabase),
    [demo, setDemo] = useState(false),
    [recovery, setRecovery] = useState(/type=(recovery|invite)/.test(location.hash)),
    [data, setData] = useState<Data>(emptyData),
    [profile, setProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>(() => {
    const p = location.hash.slice(1);
    return navigation.some((n) => n.id === p) ? (p as Page) : 'dashboard';
  });
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [mobile, setMobile] = useState(false),
    [edit, setEdit] = useState<Edit | null>(null),
    [compose, setCompose] = useState<'sale' | 'invoice' | null>(null),
    [detail, setDetail] = useState<Invoice | null>(null),
    [customerDetail, setCustomerDetail] = useState<Customer | null>(null),
    [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [to, setTo] = useState(today()),
    [limit, setLimit] = useState(30);
  const [confirm, setConfirm] = useState<{
    title: string;
    reason?: boolean;
    run: (reason: string) => Promise<void>;
  } | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setAuthReady(true);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setData(emptyData);
        setProfile(null);
      }
      if (
        event === 'PASSWORD_RECOVERY' ||
        (event === 'SIGNED_IN' && /type=invite/.test(location.hash))
      )
        setRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  const load = useCallback(async () => {
    if (demo) return;
    if (!supabase || !session) return;
    setLoading(true);
    setError('');
    try {
      const p = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (p.error)
        throw new Error(
          `Could not load your shop profile: ${p.error.message}. Check that the database migration was applied to this Supabase project.`,
        );
      if (!p.data)
        throw new Error(
          `Your login works, but this account has no shop profile. For the first administrator, run supabase/bootstrap.sql with Auth User UID ${session.user.id} and your login email, then retry. Other staff accounts must be created by an administrator.`,
        );
      if (!p.data.active)
        throw new Error('Your account has been deactivated. Contact your shop administrator.');
      setProfile(p.data as Profile);
      const tables = Object.keys(emptyData) as (keyof Data)[];
      const results = await Promise.all(
        tables.map(async (table) => {
          const rows: unknown[] = [];
          let start = 0;
          while (true) {
            const q = await supabase!
              .from(table)
              .select('*')
              .eq('shop_id', p.data.shop_id)
              .order(table === 'shop_settings' ? 'shop_id' : 'id')
              .range(start, start + 999);
            if (q.error) throw q.error;
            rows.push(...q.data);
            if (q.data.length < 1000) break;
            start += 1000;
          }
          return [table, rows];
        }),
      );
      setData(Object.fromEntries(results) as unknown as Data);
    } catch (e) {
      setProfile(null);
      setData(emptyData);
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [demo, session]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const cfg = data.shop_settings[0] || demoSettings;
  const [logoProcessing, setLogoProcessing] = useState(false);
  const role = profile?.role || 'Staff';
  const go = (p: Page) => {
    setPage(p);
    location.hash = p;
    setSearch('');
    setFilter('all');
    setLimit(30);
    setMobile(false);
  };
  useEffect(() => {
    const handler = () => {
      const p = location.hash.slice(1);
      if (navigation.some((n) => n.id === p)) {
        setPage(p as Page);
        setSearch('');
        setFilter('all');
        setLimit(30);
      }
    };
    addEventListener('hashchange', handler);
    return () => removeEventListener('hashchange', handler);
  }, []);
  async function act(work: () => Promise<void>, message = 'Changes saved.') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      setNotice(message);
      if (!demo) await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const r = await supabase!.rpc(name, args);
    if (r.error) throw r.error;
    return r.data;
  }
  const updateDemo = (fn: (d: Data) => Data) => setData((d) => fn(structuredClone(d)));
  const activeInvoices = data.invoices.map((i) => ({
    ...i,
    status: invoiceStatus(i, paidAmount(i.id, data.payments)),
  }));
  const selectedInvoices = activeInvoices.filter((i) => i.issue_date >= from && i.issue_date <= to);
  const periodSales = data.sales.filter(
    (s) =>
      s.status === 'completed' &&
      new Date(s.created_at).toLocaleDateString('en-CA', { timeZone: cfg.timezone }) >= from &&
      new Date(s.created_at).toLocaleDateString('en-CA', { timeZone: cfg.timezone }) <= to,
  );
  const periodExpenses = data.expenses.filter(
    (e) => e.status === 'active' && e.expense_date >= from && e.expense_date <= to,
  );
  const outstanding = (invoices: Invoice[]) =>
    invoices
      .filter((i) => !['draft', 'void'].includes(i.status))
      .reduce((sum, i) => sum + balanceDue(i, data.payments), 0);
  const lowStock = data.products.filter(
    (p) => p.active && p.track_stock && Number(p.quantity) <= Number(p.reorder_threshold),
  );
  const includes = (...values: unknown[]) =>
    values.join(' ').toLowerCase().includes(search.toLowerCase());
  const buttons = (action: string, onClick: () => void) => (
    <button className="btn primary" onClick={onClick}>
      <Plus size={15} />
      {action}
    </button>
  );
  const dateFilter = (
    <div className="datefilter">
      <Field label="From">
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </div>
  );
  const toolbar = (options: string[] = []) => (
    <div className="toolbar">
      <div className="search">
        <Search size={16} />
        <input
          aria-label="Search records"
          placeholder="Search records…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(30);
          }}
        />
      </div>
      {options.length > 0 && (
        <select
          aria-label="Filter records"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(30);
          }}
        >
          <option value="all">All records</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
    </div>
  );
  const table = (headers: string[], rows: ReactNode[], count = rows.length) => (
    <div className="panel tablepanel">
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.slice(0, limit)}</tbody>
        </table>
      </div>
      {rows.length === 0 && <Empty />}
      {count > limit && (
        <button className="btn loadmore" onClick={() => setLimit((n) => n + 30)}>
          Show more ({count - limit} remaining)
        </button>
      )}
    </div>
  );
  function invoiceTable(invoices: Invoice[]) {
    return table(
      ['Invoice', 'Customer', 'Issue / due', 'Total', 'Balance', 'Status', 'Details'],
      invoices.map((i) => (
        <tr key={i.id}>
          <td>
            <button className="link" onClick={() => setDetail(i)}>
              {i.number}
            </button>
          </td>
          <td>{i.customer_name}</td>
          <td>
            {i.issue_date}
            <small>Due {i.due_date}</small>
          </td>
          <td className="total">{money(i.total)}</td>
          <td>{money(balanceDue(i, data.payments))}</td>
          <td>
            <Badge>{i.status}</Badge>
          </td>
          <td>
            <button
              className="iconbtn"
              aria-label={`Open ${i.number}`}
              onClick={() => setDetail(i)}
            >
              <ChevronRight size={17} />
            </button>
          </td>
        </tr>
      )),
    );
  }
  async function saveEntity(e: FormEvent<HTMLFormElement>) {
    const f = formValues(e);
    const current = edit!;
    await act(
      async () => {
        if (!profile) throw new Error('Sign in first.');
        const kind = current.kind;
        const id = current.record?.id || uid();
        let values: Record<string, unknown> = { ...f };
        if (kind === 'adjust') {
          const delta = Number(f.delta);
          if (!Number.isFinite(delta) || delta === 0 || !f.reason.trim())
            throw new Error('Enter a nonzero quantity and a reason.');
          if (demo) {
            const p = data.products.find((p) => p.id === f.product_id);
            if (!p || !p.track_stock || p.quantity + delta < 0)
              throw new Error('Insufficient stock or invalid product.');
            updateDemo((d) => {
              d.products.find((p) => p.id === f.product_id)!.quantity += delta;
              d.stock_movements.unshift({
                id: uid(),
                product_id: p.id,
                delta,
                reason: f.reason,
                created_by: profile.id,
                created_at: new Date().toISOString(),
              });
              return d;
            });
          } else
            await rpc('adjust_stock', {
              p_product_id: f.product_id,
              p_delta: delta,
              p_reason: f.reason,
            });
        } else if (kind === 'payment') {
          const invoice = current.record as Invoice;
          const amount = Number(f.amount);
          const balance = balanceDue(invoice, data.payments);
          if (!Number.isFinite(amount) || amount <= 0 || amount > balance)
            throw new Error('Payment must be positive and no greater than the balance.');
          if (demo)
            updateDemo((d) => {
              d.payments.push({
                id: uid(),
                invoice_id: invoice.id,
                amount,
                method: f.method,
                reference: f.reference,
                created_at: new Date().toISOString(),
              });
              return d;
            });
          else
            await rpc('record_payment', {
              p_id: invoice.id,
              p_amount: amount,
              p_method: f.method,
              p_reference: f.reference,
              p_request_id: f.request_id,
            });
        } else if (kind === 'invite' || kind === 'password') {
          if (!can(profile.role, 'admin')) throw new Error('Administrator access required.');
          if (f.password !== f.confirm_password) throw new Error('Passwords do not match.');
          if (f.password.length < 12 || new TextEncoder().encode(f.password).length > 72)
            throw new Error('Use at least 12 characters and at most 72 UTF-8 bytes.');
          if (demo)
            throw new Error('Staff accounts and passwords require a connected Supabase project.');
          const body =
            kind === 'invite'
              ? {
                  action: 'create',
                  display_name: f.display_name,
                  email: f.email,
                  role: f.role,
                  password: f.password,
                }
              : { action: 'password', user_id: current.record!.id, password: f.password };
          const result = await supabase!.functions.invoke('manage-staff', { body });
          if (result.error) {
            let message = result.error.message;
            if (result.error.name === 'FunctionsFetchError') {
              message = `Could not reach staff management. Deploy the manage-staff Edge Function and set APP_URL to ${location.origin}. Run the deploy-staff.ps1 helper described in README.`;
            }
            try {
              const body = await result.error.context.json();
              message =
                result.error.context.status === 404
                  ? 'Staff management is not deployed. Run scripts/deploy-staff.ps1, then retry.'
                  : body.error || body.message || message;
            } catch {
              /* use transport error */
            }
            throw new Error(message);
          }
          if (result.data?.warning) {
            setEdit(null);
            throw new Error(`Password changed. ${result.data.warning}`);
          }
        } else {
          if (kind === 'product') {
            values = {
              ...f,
              price: Number(f.price),
              cost: Number(f.cost),
              reorder_threshold: Number(f.reorder_threshold),
              active: f.active === 'true',
            };
            if (!current.record) values.track_stock = f.track_stock === 'true';
            else delete values.track_stock;
          }
          if (kind === 'customer') values.active = f.active === 'true';
          if (kind === 'expense') values.amount = Number(f.amount);
          const target = (
            {
              customer: 'customers',
              product: 'products',
              expense: 'expenses',
              category: 'expense_categories',
            } as const
          )[kind];
          if (!target) throw new Error('Unsupported action.');
          if (demo)
            updateDemo((d) => {
              const arr = d[target] as unknown as Record<string, unknown>[];
              const index = arr.findIndex((r) => r.id === id);
              const obj = {
                ...(index >= 0 ? arr[index] : {}),
                ...values,
                id,
                shop_id: profile.shop_id,
                ...(kind === 'product' && !current.record ? { quantity: 0 } : {}),
                ...(kind === 'expense' && !current.record
                  ? { created_by: profile.id, status: 'active' }
                  : {}),
              };
              if (index < 0) arr.push(obj);
              else arr[index] = obj;
              return d;
            });
          else {
            const q = current.record
              ? supabase!.from(target).update(values).eq('id', id)
              : supabase!.from(target).insert({ ...values, id, shop_id: profile.shop_id });
            const result = await q.select();
            if (result.error) throw result.error;
            if (!result.data?.length)
              throw new Error('Record was not saved. Check your permissions.');
          }
        }
        setEdit(null);
      },
      current.kind === 'invite'
        ? 'Staff account created. They can sign in immediately without email confirmation.'
        : current.kind === 'password'
          ? 'Password changed successfully.'
          : 'Saved successfully.',
    );
  }
  async function createDocument(payload: Record<string, unknown>) {
    await act(async () => {
      if (!profile) throw new Error('Sign in first.');
      const lines = payload.lines as Line[];
      const calc = totals(lines, Number(payload.discount), Number(payload.tax_rate));
      let id: string;
      if (demo) {
        if (!payload.draft) {
          for (const p of data.products) {
            const qty = lines
              .filter((l) => l.product_id === p.id)
              .reduce((sum, l) => sum + l.quantity, 0);
            if (qty && (!p.active || (p.track_stock && qty > p.quantity)))
              throw new Error(`Insufficient stock: ${p.name}`);
          }
        }
        if (payload.method === 'invoice' && !payload.customer_id && !payload.draft)
          throw new Error('Select a customer for credit terms.');
        id = uid();
        const c = data.customers.find((c) => c.id === payload.customer_id);
        const created = new Date().toISOString();
        const invoice: Invoice = {
          id,
          shop_id: 'demo',
          number: `INV-${String(data.invoices.length + 1).padStart(6, '0')}`,
          customer_id: c?.id || null,
          customer_name: c?.name || 'Walk-in customer',
          customer_email: c?.email || '',
          billing_address: c?.billing_address || '',
          business_details: structuredClone(cfg),
          issue_date: String(payload.issue_date),
          due_date: String(payload.due_date),
          discount: Number(payload.discount),
          tax_rate: Number(payload.tax_rate),
          tax_label: cfg.tax_label,
          subtotal: calc.subtotal,
          total: calc.total,
          status: payload.draft ? 'draft' : payload.method === 'invoice' ? 'pending' : 'paid',
          notes: String(payload.notes),
          terms: cfg.terms,
          created_at: created,
        };
        updateDemo((d) => {
          d.invoices.push(invoice);
          d.invoice_items.push(...lines.map((l) => ({ ...l, id: uid(), invoice_id: id })));
          if (!payload.draft) {
            d.sales.push({
              id: uid(),
              invoice_id: id,
              customer_id: invoice.customer_id,
              total: calc.total,
              method: payload.method as 'invoice',
              created_at: created,
              status: 'completed',
            });
            for (const p of d.products) {
              const qty = lines
                .filter((l) => l.product_id === p.id)
                .reduce((sum, l) => sum + l.quantity, 0);
              if (p.track_stock && qty) {
                p.quantity -= qty;
                d.stock_movements.push({
                  id: uid(),
                  product_id: p.id,
                  delta: -qty,
                  reason: `Invoice ${invoice.number}`,
                  created_by: profile.id,
                  created_at: created,
                });
              }
            }
            if (payload.method !== 'invoice' && calc.total > 0)
              d.payments.push({
                id: uid(),
                invoice_id: id,
                amount: calc.total,
                method: String(payload.method),
                reference: '',
                created_at: created,
              });
          }
          return d;
        });
      } else {
        id = await rpc('create_document', { p_payload: { ...payload, shop_id: profile.shop_id } });
      }
      setCompose(null);
      go('invoices');
    }, 'Invoice saved. Open it for a receipt, PDF, or payment.');
  }
  async function changeMember(p: Profile, changes: { role?: Role; active?: boolean }) {
    if (demo)
      updateDemo((d) => {
        const member = d.profiles.find((m) => m.id === p.id)!;
        Object.assign(member, changes);
        return d;
      });
    else
      await rpc('manage_member', {
        p_id: p.id,
        p_role: changes.role || p.role,
        p_active: changes.active ?? p.active,
      });
  }
  function askVoid(i: Invoice) {
    setConfirm({
      title: `Void ${i.number}? Unpaid stock will be returned.`,
      reason: true,
      run: async (reason) => {
        if (demo) {
          if (paidAmount(i.id, data.payments) > 0)
            throw new Error('An invoice with payments cannot be voided.');
          updateDemo((d) => {
            d.invoices.find((x) => x.id === i.id)!.status = 'void';
            d.sales.filter((s) => s.invoice_id === i.id).forEach((s) => (s.status = 'void'));
            const movements = d.stock_movements.filter((m) => m.reason === `Invoice ${i.number}`);
            for (const m of movements) {
              d.products.find((p) => p.id === m.product_id)!.quantity -= m.delta;
              d.stock_movements.push({
                ...m,
                id: uid(),
                delta: -m.delta,
                reason: `Void: ${reason}`,
              });
            }
            return d;
          });
        } else await rpc('void_invoice', { p_id: i.id, p_reason: reason });
        setDetail(null);
      },
    });
  }
  function askIssue(i: Invoice) {
    setConfirm({
      title: `Issue ${i.number} and deduct stock?`,
      run: async () => {
        if (demo) {
          if (!i.customer_id) throw new Error('Credit invoices require a customer.');
          const lines = data.invoice_items.filter((l) => l.invoice_id === i.id);
          for (const p of data.products) {
            const q = lines
              .filter((l) => l.product_id === p.id)
              .reduce((s, l) => s + l.quantity, 0);
            if (q && (!p.active || (p.track_stock && q > p.quantity)))
              throw new Error(`Insufficient stock: ${p.name}`);
          }
          updateDemo((d) => {
            d.invoices.find((x) => x.id === i.id)!.status = i.total === 0 ? 'paid' : 'pending';
            d.sales.push({
              id: uid(),
              invoice_id: i.id,
              customer_id: i.customer_id,
              total: i.total,
              method: 'invoice',
              created_at: new Date().toISOString(),
              status: 'completed',
            });
            for (const p of d.products) {
              const qty = lines
                .filter((l) => l.product_id === p.id)
                .reduce((sum, l) => sum + l.quantity, 0);
              if (p.track_stock && qty) {
                p.quantity -= qty;
                d.stock_movements.push({
                  id: uid(),
                  product_id: p.id,
                  delta: -qty,
                  reason: `Invoice ${i.number}`,
                  created_by: profile!.id,
                  created_at: new Date().toISOString(),
                });
              }
            }
            return d;
          });
        } else await rpc('issue_invoice', { p_id: i.id });
        setDetail(null);
      },
    });
  }
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    const f = formValues(e);
    if (logoProcessing) {
      setError('Wait for the logo to finish processing, then save settings.');
      return;
    }
    await act(async () => {
      const values = {
        ...f,
        tax_rate: Number(f.tax_rate),
        payment_terms_days: Number(f.payment_terms_days),
      };
      if (demo)
        updateDemo((d) => {
          Object.assign(d.shop_settings[0], values);
          return d;
        });
      else {
        const r = await supabase!
          .from('shop_settings')
          .update(values)
          .eq('shop_id', profile!.shop_id)
          .select();
        if (r.error) throw r.error;
        if (!r.data?.length) throw new Error('Settings were not saved.');
        setData((current) => ({ ...current, shop_settings: r.data as Settings[] }));
      }
    });
  }
  const visibleNav = navigation
    .filter((n) => !(n.id === 'users' || n.id === 'settings') || can(role, 'admin'))
    .filter((n) => n.id !== 'expenses' || can(role, 'expense'));

  if (!authReady)
    return (
      <div className="auth">
        <p role="status">Loading your workspace…</p>
      </div>
    );
  if ((!session && !demo) || recovery)
    return (
      <Auth
        recovery={recovery}
        error={error}
        onError={setError}
        onRecovered={() => {
          setRecovery(false);
          location.hash = 'dashboard';
        }}
        onDemo={() => {
          setDemo(true);
          const d = demoData();
          setData(d);
          setProfile(d.profiles[0]);
          setError('');
        }}
      />
    );
  if (!profile)
    return (
      <div className="auth">
        <div className="loginbox">
          <Printer size={32} />
          <h1>{loading ? 'Opening your workspace…' : 'Shop access required'}</h1>
          <p role="alert">{error}</p>
          <button className="btn" onClick={() => void load()}>
            Retry
          </button>
          <button className="btn" onClick={() => void supabase?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  const selectedDetail = detail ? activeInvoices.find((i) => i.id === detail.id) || detail : null;
  return (
    <div className="app">
      {mobile && (
        <button
          className="navscrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a href="#dashboard" className="brand" onClick={() => go('dashboard')}>
          <span className="brandmark">
            <Printer size={23} />
          </span>
          <span className="brandname">
            Press & Paper<small>PRINT SHOP POS</small>
          </span>
        </a>
        <div className="navlabel">Workspace</div>
        <nav className="nav" aria-label="Main navigation">
          {visibleNav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              aria-current={page === n.id ? 'page' : undefined}
              onClick={() => go(n.id)}
            >
              <n.icon size={18} />
              {n.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="shop-switch">
            <small>ACTIVE SHOP</small>
            {cfg.business_name}
            <span className="online">{demo ? 'Demo workspace' : 'Connected workspace'}</span>
          </div>
          <div className="profile">
            <div className="avatar">
              {profile.display_name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong>{profile.display_name}</strong>
              <small>{role}</small>
            </div>
            <button
              className="iconbtn"
              aria-label="Sign out"
              onClick={() =>
                void act(async () => {
                  if (!demo) {
                    const r = await supabase!.auth.signOut();
                    if (r.error) throw r.error;
                  }
                  setDemo(false);
                  setProfile(null);
                  setData(emptyData);
                  setDetail(null);
                  setEdit(null);
                  setCompose(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            <button
              className="mobile-toggle iconbtn"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <b>{navigation.find((n) => n.id === page)?.name}</b>
          </div>
          <span className="date">
            {new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: cfg.timezone }).format(
              new Date(),
            )}
          </span>
        </header>
        <div className="content">
          {demo && (
            <div className="demobanner">
              Fictional demo workspace · Changes last only for this session.{' '}
              <button
                className="link"
                onClick={() => {
                  setDemo(false);
                  setProfile(null);
                  setData(emptyData);
                }}
              >
                Connect your shop
              </button>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button className="iconbtn" aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {loading && (
            <div className="loading" role="status">
              Refreshing workspace…
            </div>
          )}
          <div className="pagehead">
            <div>
              <div className="eyebrow">YOUR PRINT SHOP, IN SYNC</div>
              <h1>
                {page === 'dashboard'
                  ? `Good ${new Date().getHours() < 12 ? 'morning' : 'day'}, ${profile.display_name.split(' ')[0]}`
                  : navigation.find((n) => n.id === page)?.name}
              </h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="actions">
              {(page === 'sales' || page === 'dashboard') &&
                can(role, 'sell') &&
                buttons('New sale', () => setCompose('sale'))}
              {page === 'invoices' &&
                can(role, 'invoice') &&
                buttons('New invoice', () => setCompose('invoice'))}
              {page === 'customers' &&
                can(role, 'customer') &&
                buttons('Add customer', () => setEdit({ kind: 'customer' }))}
              {page === 'inventory' && can(role, 'inventory') && (
                <>
                  <button className="btn" onClick={() => setEdit({ kind: 'adjust' })}>
                    Stock adjustment
                  </button>
                  {buttons('Add product', () => setEdit({ kind: 'product' }))}
                </>
              )}
              {page === 'expenses' && can(role, 'expense') && (
                <>
                  <button className="btn" onClick={() => setEdit({ kind: 'category' })}>
                    Add category
                  </button>
                  {buttons('Add expense', () => setEdit({ kind: 'expense' }))}
                </>
              )}
              {page === 'users' &&
                can(role, 'admin') &&
                buttons('Add user', () => setEdit({ kind: 'invite' }))}
            </div>
          </div>
          {['dashboard', 'sales', 'invoices', 'expenses'].includes(page) && dateFilter}
          {page === 'dashboard' && (
            <>
              <div className="stats">
                <Stat
                  label="Sales"
                  value={money(periodSales.reduce((s, x) => s + Number(x.total), 0))}
                  hint={`${periodSales.length} completed orders`}
                />
                <Stat
                  label="Outstanding invoices"
                  value={money(outstanding(selectedInvoices))}
                  hint={`${selectedInvoices.filter((i) => !['draft', 'paid', 'void'].includes(i.status)).length} open invoices issued in period`}
                />
                <Stat
                  label="Expenses"
                  value={
                    can(role, 'expense')
                      ? money(periodExpenses.reduce((s, e) => s + Number(e.amount), 0))
                      : 'Restricted'
                  }
                  hint={
                    can(role, 'expense')
                      ? `${periodExpenses.length} entries`
                      : 'Administrator / Accountant access'
                  }
                />
                <Stat
                  label="Low stock items"
                  value={lowStock.length}
                  hint="Current stock · needs attention"
                />
              </div>
              <div className="grid2">
                <div className="panel">
                  <div className="panelhead">
                    <h2>Sales overview</h2>
                    <span className="muted">Last 7 days of selected period</span>
                  </div>
                  <SalesChart sales={periodSales} end={to} />
                </div>
                <div className="panel">
                  <div className="panelhead">
                    <h2>Sales by service</h2>
                    <button className="link" onClick={() => go('sales')}>
                      View sales →
                    </button>
                  </div>
                  <ServiceMix data={data} invoiceIds={periodSales.map((s) => s.invoice_id)} />
                </div>
              </div>
              <div className="panelhead">
                <h2>Recent invoices</h2>
                <button className="link" onClick={() => go('invoices')}>
                  View all invoices →
                </button>
              </div>
              {invoiceTable(
                selectedInvoices
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .slice(0, 5),
              )}
              {lowStock.length > 0 && (
                <div className="wide-note">
                  <strong>Time to restock.</strong>{' '}
                  {lowStock.map((p) => `${p.name} (${p.quantity} ${p.unit})`).join(' · ')}{' '}
                  <button className="link" onClick={() => go('inventory')}>
                    Open inventory →
                  </button>
                </div>
              )}
            </>
          )}
          {page === 'invoices' && (
            <>
              <div className="stats">
                <Stat label="Outstanding" value={money(outstanding(selectedInvoices))} />
                <Stat
                  label="Paid on these invoices"
                  value={money(
                    selectedInvoices.reduce((s, i) => s + paidAmount(i.id, data.payments), 0),
                  )}
                />
                <Stat
                  label="Overdue balance"
                  value={money(outstanding(selectedInvoices.filter((i) => i.status === 'overdue')))}
                />
                <Stat
                  label="Draft invoices"
                  value={selectedInvoices.filter((i) => i.status === 'draft').length}
                />
              </div>
              {toolbar(['draft', 'pending', 'partially paid', 'paid', 'overdue', 'void'])}
              {invoiceTable(
                selectedInvoices
                  .filter(
                    (i) =>
                      includes(i.number, i.customer_name) &&
                      (filter === 'all' || i.status === filter),
                  )
                  .sort((a, b) => b.created_at.localeCompare(a.created_at)),
              )}
            </>
          )}
          {page === 'sales' && (
            <>
              {toolbar(['cash', 'gcash', 'bank transfer', 'invoice'])}
              <div className="stats">
                <Stat
                  label="Sales in period"
                  value={money(periodSales.reduce((s, x) => s + Number(x.total), 0))}
                />
                <Stat label="Transactions" value={periodSales.length} />
                <Stat
                  label="Average sale"
                  value={money(
                    periodSales.length
                      ? periodSales.reduce((s, x) => s + Number(x.total), 0) / periodSales.length
                      : 0,
                  )}
                />
                <Stat
                  label="Collections in period"
                  value={money(
                    data.payments
                      .filter((p) => {
                        const d = new Date(p.created_at).toLocaleDateString('en-CA', {
                          timeZone: cfg.timezone,
                        });
                        return d >= from && d <= to;
                      })
                      .reduce((s, p) => s + Number(p.amount), 0),
                  )}
                />
              </div>
              {table(
                ['Sale', 'Customer', 'Date', 'Payment method', 'Total', 'Status', 'Receipt'],
                data.sales
                  .filter((s) => {
                    const date = new Date(s.created_at).toLocaleDateString('en-CA', {
                      timeZone: cfg.timezone,
                    });
                    const i = data.invoices.find((i) => i.id === s.invoice_id);
                    return (
                      date >= from &&
                      date <= to &&
                      includes(s.id, i?.customer_name, i?.number) &&
                      (filter === 'all' || s.method === filter)
                    );
                  })
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((s) => {
                    const i = activeInvoices.find((i) => i.id === s.invoice_id)!;
                    return (
                      <tr key={s.id}>
                        <td>{i?.number}</td>
                        <td>{i?.customer_name}</td>
                        <td>
                          {new Date(s.created_at).toLocaleString('en-PH', {
                            timeZone: cfg.timezone,
                          })}
                        </td>
                        <td className="capitalize">{s.method}</td>
                        <td className="total">{money(s.total)}</td>
                        <td>
                          <Badge>{s.status === 'void' ? 'void' : i?.status}</Badge>
                        </td>
                        <td>
                          <button className="link" onClick={() => setDetail(i)}>
                            View receipt
                          </button>
                        </td>
                      </tr>
                    );
                  }),
              )}
            </>
          )}
          {page === 'inventory' && (
            <>
              <div className="stats">
                <Stat
                  label="Products & services"
                  value={data.products.filter((p) => p.active).length}
                  hint="Active catalog"
                />
                <Stat
                  label="Inventory value"
                  value={money(
                    data.products
                      .filter((p) => p.active && p.track_stock)
                      .reduce((s, p) => s + p.quantity * p.cost, 0),
                  )}
                  hint="At unit cost"
                />
                <Stat label="Low stock" value={lowStock.length} hint="Current stock" />
                <Stat
                  label="Out of stock"
                  value={lowStock.filter((p) => p.quantity === 0).length}
                  hint="Current stock"
                />
              </div>
              {toolbar([
                'Low stock',
                ...new Set(data.products.map((p) => p.category).filter(Boolean)),
              ])}
              {table(
                [
                  'Product / material',
                  'SKU',
                  'On hand',
                  'Reorder at',
                  'Price / cost',
                  'Status',
                  'Actions',
                ],
                data.products
                  .filter(
                    (p) =>
                      includes(p.name, p.sku, p.category) &&
                      (filter === 'all' ||
                        (filter === 'Low stock'
                          ? p.track_stock && p.quantity <= p.reorder_threshold
                          : p.category === filter)),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="product">
                          <span className="productpic">
                            <Package size={18} />
                          </span>
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.category} · {p.unit}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>{p.sku}</td>
                      <td>
                        {p.track_stock ? (
                          <button className="link" onClick={() => setMovementProduct(p)}>
                            {p.quantity} {p.unit}
                          </button>
                        ) : (
                          'Service'
                        )}
                      </td>
                      <td>{p.track_stock ? p.reorder_threshold : '—'}</td>
                      <td>
                        {money(p.price)}
                        <small>Cost {money(p.cost)}</small>
                      </td>
                      <td>
                        <Badge>
                          {!p.active
                            ? 'inactive'
                            : p.track_stock && p.quantity <= p.reorder_threshold
                              ? 'low stock'
                              : 'active'}
                        </Badge>
                      </td>
                      <td>
                        {can(role, 'inventory') && (
                          <button
                            className="link"
                            onClick={() => setEdit({ kind: 'product', record: p })}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )),
              )}
              <div className="wide-note">
                Stock changes always include a reason and actor. Click an on-hand quantity to see
                its movement history.
              </div>
            </>
          )}
          {page === 'expenses' &&
            (can(role, 'expense') ? (
              <>
                <div className="stats">
                  <Stat
                    label="Period expenses"
                    value={money(periodExpenses.reduce((s, e) => s + Number(e.amount), 0))}
                  />
                  <Stat label="Entries" value={periodExpenses.length} />
                </div>
                {toolbar(data.expense_categories.map((c) => c.name))}
                {table(
                  [
                    'Description',
                    'Category',
                    'Date',
                    'Vendor / payee',
                    'Amount',
                    'Creator',
                    'Actions',
                  ],
                  data.expenses
                    .filter(
                      (e) =>
                        e.expense_date >= from &&
                        e.expense_date <= to &&
                        includes(e.description, e.vendor) &&
                        (filter === 'all' ||
                          data.expense_categories.find((c) => c.id === e.category_id)?.name ===
                            filter),
                    )
                    .map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{e.description}</strong>
                          <small>{e.receipt_reference}</small>
                          {e.status === 'void' && <Badge>void</Badge>}
                        </td>
                        <td>{data.expense_categories.find((c) => c.id === e.category_id)?.name}</td>
                        <td>{e.expense_date}</td>
                        <td>{e.vendor}</td>
                        <td className="total">{money(e.amount)}</td>
                        <td>
                          {data.profiles.find((p) => p.id === e.created_by)?.display_name ||
                            e.created_by.slice(0, 8)}
                        </td>
                        <td>
                          <button
                            className="link"
                            onClick={() => setEdit({ kind: 'expense', record: e })}
                          >
                            Edit
                          </button>
                          {e.status !== 'void' && (
                            <button
                              className="link danger"
                              onClick={() =>
                                setConfirm({
                                  title: `Void expense “${e.description}”?`,
                                  run: async () => {
                                    if (demo)
                                      updateDemo((d) => {
                                        d.expenses.find((x) => x.id === e.id)!.status = 'void';
                                        return d;
                                      });
                                    else {
                                      const r = await supabase!
                                        .from('expenses')
                                        .update({ status: 'void' })
                                        .eq('id', e.id)
                                        .select();
                                      if (r.error) throw r.error;
                                      if (!r.data.length) throw new Error('Expense not updated.');
                                    }
                                  },
                                })
                              }
                            >
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    )),
                )}
              </>
            ) : (
              <Empty>Administrator or Accountant access is required.</Empty>
            ))}
          {page === 'customers' && (
            <>
              {toolbar(['With outstanding balance', 'Inactive'])}
              {table(
                ['Customer', 'Contact', 'Orders', 'Outstanding', 'Actions'],
                data.customers
                  .filter(
                    (c) =>
                      includes(c.name, c.email, c.phone) &&
                      (filter === 'all' ||
                        (filter === 'Inactive'
                          ? !c.active
                          : outstanding(activeInvoices.filter((i) => i.customer_id === c.id)) > 0)),
                  )
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <small>{c.billing_address}</small>
                        {!c.active && <Badge>inactive</Badge>}
                      </td>
                      <td>
                        {c.email}
                        <small>{c.phone}</small>
                      </td>
                      <td>
                        {
                          data.sales.filter(
                            (s) => s.customer_id === c.id && s.status === 'completed',
                          ).length
                        }
                      </td>
                      <td className="total">
                        {money(outstanding(activeInvoices.filter((i) => i.customer_id === c.id)))}
                      </td>
                      <td>
                        <button className="link" onClick={() => setCustomerDetail(c)}>
                          History
                        </button>
                        <button
                          className="link"
                          onClick={() => setEdit({ kind: 'customer', record: c })}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )),
              )}
            </>
          )}
          {page === 'users' &&
            (can(role, 'admin') ? (
              <>
                <div className="wide-note topnote">
                  Administrators create staff accounts and set passwords. No confirmation email is
                  required. Use Set password to replace a password, or Deactivate to remove shop
                  access.
                </div>
                {toolbar(['Administrator', 'Cashier', 'Staff', 'Accountant'])}
                {table(
                  ['Team member', 'Email', 'Role', 'Status', 'Access / password'],
                  data.profiles
                    .filter(
                      (p) =>
                        includes(p.display_name, p.email) &&
                        (filter === 'all' || p.role === filter),
                    )
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.display_name}</strong>
                        </td>
                        <td>{p.email}</td>
                        <td>
                          <select
                            aria-label={`Role for ${p.display_name}`}
                            value={p.role}
                            disabled={busy || p.id === profile.id}
                            onChange={(e) => {
                              const next = e.target.value as Role;
                              setConfirm({
                                title: `Change ${p.display_name}'s role to ${next}?`,
                                run: () => changeMember(p, { role: next }),
                              });
                            }}
                          >
                            {['Administrator', 'Cashier', 'Staff', 'Accountant'].map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <Badge>{p.active ? 'active' : 'inactive'}</Badge>
                        </td>
                        <td>
                          <button
                            className="link"
                            disabled={busy || p.id === profile.id}
                            onClick={() =>
                              setConfirm({
                                title: `${p.active ? 'Deactivate' : 'Reactivate'} ${p.display_name}?`,
                                run: () => changeMember(p, { active: !p.active }),
                              })
                            }
                          >
                            {p.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                          <button
                            className="link"
                            disabled={busy}
                            onClick={() => setEdit({ kind: 'password', record: p })}
                          >
                            Set password
                          </button>
                        </td>
                      </tr>
                    )),
                )}
                <div className="panel permissions">
                  <h2>Role permissions</h2>
                  <p>
                    <strong>Administrator</strong> — Full shop operations, team, and settings.
                  </p>
                  <p>
                    <strong>Cashier</strong> — Sales, invoices, customers, and collections.
                  </p>
                  <p>
                    <strong>Staff</strong> — Catalog, stock adjustments, and customers.
                  </p>
                  <p>
                    <strong>Accountant</strong> — Invoices, collections, expenses, and financial
                    review.
                  </p>
                </div>
              </>
            ) : (
              <Empty>Administrator access is required.</Empty>
            ))}
          {page === 'settings' &&
            (can(role, 'admin') ? (
              <form key={cfg.shop_id} onSubmit={saveSettings}>
                <div className="grid2">
                  <div className="panel">
                    <h2>Shop profile</h2>
                    <Field label="Business name">
                      <input
                        name="business_name"
                        defaultValue={cfg.business_name}
                        required
                        maxLength={120}
                      />
                    </Field>
                    <div className="formgrid">
                      <Field label="Email">
                        <input name="email" type="email" defaultValue={cfg.email} />
                      </Field>
                      <Field label="Phone">
                        <input name="phone" defaultValue={cfg.phone} />
                      </Field>
                    </div>
                    <Field label="Business address">
                      <textarea name="address" defaultValue={cfg.address} />
                    </Field>
                    <LogoField
                      value={cfg.logo_url}
                      onError={setError}
                      onProcessingChange={setLogoProcessing}
                    />
                  </div>
                  <div className="panel">
                    <h2>Invoice preferences</h2>
                    <div className="formgrid">
                      <Field label="Invoice prefix">
                        <input
                          name="invoice_prefix"
                          required
                          pattern="[A-Za-z0-9-]{1,24}"
                          defaultValue={cfg.invoice_prefix}
                        />
                      </Field>
                      <Field label="Payment terms (days)">
                        <input
                          name="payment_terms_days"
                          type="number"
                          min="0"
                          max="365"
                          required
                          defaultValue={cfg.payment_terms_days}
                        />
                      </Field>
                    </div>
                    <Field label="Currency">
                      <input value="PHP · Philippine Peso" readOnly />
                    </Field>
                    <div className="formgrid">
                      <Field label="Tax label">
                        <input name="tax_label" defaultValue={cfg.tax_label} required />
                      </Field>
                      <Field label="Default tax rate (%)">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          required
                          name="tax_rate"
                          defaultValue={cfg.tax_rate}
                        />
                      </Field>
                    </div>
                    <p className="muted">
                      Tax defaults to 0%. Set your tax treatment to match your business
                      registration. Numbers are allocated sequentially by the server and cannot be
                      reset here.
                    </p>
                    <Field label="PDF accent color">
                      <input name="brand_color" type="color" defaultValue={cfg.brand_color} />
                    </Field>
                  </div>
                </div>
                <div className="panel">
                  <Field label="Invoice terms / PDF footer">
                    <textarea name="terms" defaultValue={cfg.terms} rows={3} />
                  </Field>
                  <button className="btn primary" disabled={busy || logoProcessing}>
                    {logoProcessing ? 'Processing logo…' : 'Save settings'}
                  </button>
                </div>
              </form>
            ) : (
              <Empty>Administrator access is required.</Empty>
            ))}
        </div>
      </main>
      {compose && (
        <Composer
          mode={compose}
          data={data}
          cfg={cfg}
          busy={busy}
          error={error}
          onClose={() => setCompose(null)}
          onSave={createDocument}
        />
      )}
      {edit && (
        <EntityForm
          edit={edit}
          data={data}
          busy={busy}
          error={error}
          onClose={() => setEdit(null)}
          onSubmit={saveEntity}
        />
      )}
      {selectedDetail && (
        <InvoiceDetail
          invoice={selectedDetail}
          data={data}
          cfg={cfg}
          role={role}
          busy={busy}
          onClose={() => setDetail(null)}
          onPay={() => {
            setDetail(null);
            setEdit({ kind: 'payment', record: selectedDetail });
          }}
          onVoid={() => askVoid(selectedDetail)}
          onIssue={() => askIssue(selectedDetail)}
          notify={setNotice}
          onError={setError}
        />
      )}
      {customerDetail && (
        <Modal title={customerDetail.name} onClose={() => setCustomerDetail(null)}>
          <p>
            {customerDetail.email} · {customerDetail.phone}
          </p>
          <p>{customerDetail.billing_address}</p>
          <p className="muted">{customerDetail.notes}</p>
          <h3>Order history & balances</h3>
          {invoiceTable(activeInvoices.filter((i) => i.customer_id === customerDetail.id))}
        </Modal>
      )}
      {movementProduct && (
        <Modal
          title={`${movementProduct.name} · Stock history`}
          onClose={() => setMovementProduct(null)}
        >
          {table(
            ['Date', 'Change', 'Reason', 'Actor'],
            data.stock_movements
              .filter((m) => m.product_id === movementProduct.id)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((m) => (
                <tr key={m.id}>
                  <td>
                    {new Date(m.created_at).toLocaleString('en-PH', { timeZone: cfg.timezone })}
                  </td>
                  <td className={m.delta > 0 ? 'positive' : 'negative'}>
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                  </td>
                  <td>{m.reason}</td>
                  <td>
                    {data.profiles.find((p) => p.id === m.created_by)?.display_name ||
                      m.created_by.slice(0, 8)}
                  </td>
                </tr>
              )),
          )}
        </Modal>
      )}
      {confirm && (
        <Modal
          title="Confirm action"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>{confirm.title}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              const f = formValues(e);
              void act(async () => {
                await confirm.run(f.reason || '');
                setConfirm(null);
              });
            }}
          >
            {confirm.reason && (
              <Field label="Reason">
                <textarea name="reason" required minLength={3} />
              </Field>
            )}
            <div className="modalfoot">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LogoField({
  value,
  onError,
  onProcessingChange,
}: {
  value: string;
  onError: (s: string) => void;
  onProcessingChange: (processing: boolean) => void;
}) {
  const [logo, setLogo] = useState(value);
  const [processing, setProcessing] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      onProcessingChange(false);
    },
    [onProcessingChange],
  );
  return (
    <Field label="Invoice logo (PNG / JPEG)">
      <input name="logo_url" type="hidden" value={logo} />
      {logo && (
        <img
          src={logo}
          alt="Shop logo preview"
          style={{ width: 64, height: 64, objectFit: 'contain' }}
        />
      )}
      <input
        type="file"
        disabled={processing}
        accept="image/png,image/jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 500000) {
            onError('Choose a PNG or JPEG logo smaller than 500 KB.');
            return;
          }
          const currentGeneration = ++generation.current;
          setProcessing(true);
          onProcessingChange(true);
          const finish = (error?: string) => {
            if (currentGeneration !== generation.current) return;
            setProcessing(false);
            onProcessingChange(false);
            if (error) onError(error);
          };
          const reader = new FileReader();
          reader.onload = () => {
            if (currentGeneration !== generation.current) return;
            const image = new Image();
            image.onload = () => {
              if (currentGeneration !== generation.current) return;
              try {
                const scale = Math.min(1, 256 / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
                setLogo(canvas.toDataURL(file.type));
                finish();
              } catch {
                finish('Could not prepare the logo. Choose a valid PNG or JPEG image.');
              }
            };
            image.onerror = () => finish('This file could not be decoded as an image.');
            image.src = String(reader.result);
          };
          reader.onerror = () => finish('Could not read the logo.');
          reader.onabort = () => finish('Logo upload was cancelled.');
          reader.readAsDataURL(file);
        }}
      />
      {logo && (
        <button type="button" className="link" disabled={processing} onClick={() => setLogo('')}>
          Remove logo
        </button>
      )}
      <small className="muted">Up to 500 KB. The logo is embedded in invoice PDFs.</small>
      {processing && <small role="status">Preparing logo…</small>}
    </Field>
  );
}

function Auth({
  recovery,
  error,
  onError,
  onRecovered,
  onDemo,
}: {
  recovery: boolean;
  error: string;
  onError: (s: string) => void;
  onRecovered: () => void;
  onDemo: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    const f = formValues(e);
    if (!supabase) {
      onError('Configure Supabase or explore the demo.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const result = await supabase.auth.signInWithPassword({
        email: f.email,
        password: f.password,
      });
      if (result.error) throw result.error;
    } catch (err) {
      onError(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="loginbox">
        <div className="brand">
          <span className="brandmark">
            <Printer />
          </span>
          <span className="brandname">
            Press & Paper<small>PRINT SHOP POS</small>
          </span>
        </div>
        <h1>{recovery ? 'Contact your administrator' : 'Welcome back'}</h1>
        <p>
          {recovery
            ? 'Passwords are managed by your shop administrator. Ask them to set a new password for your account.'
            : 'A little less admin. A little more creating.'}
        </p>
        {!supabase && (
          <div className="wide-note">
            Supabase is not configured yet. Explore the fictional demo or follow the README to
            connect your shop.
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {recovery ? (
          <button
            className="btn full"
            onClick={() =>
              void (async () => {
                const result = await supabase?.auth.signOut();
                if (result?.error) {
                  onError(result.error.message);
                  return;
                }
                onRecovered();
              })()
            }
          >
            Back to sign in
          </button>
        ) : (
          <>
            <form onSubmit={submit}>
              <Field label="Email address">
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@printshop.com"
                />
              </Field>
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                />
              </Field>
              <button className="btn primary full" disabled={busy}>
                {busy ? 'Please wait?' : 'Sign in'}
              </button>
            </form>
            <p className="authnote">
              Forgot your password? Ask your shop administrator to set a new one.
            </p>
            <div className="divider">or take a look around</div>
            <button className="btn full" onClick={onDemo}>
              Explore demo workspace <ArrowUpRight size={15} />
            </button>
          </>
        )}
        <p className="authnote">Access and passwords are managed by your shop administrator.</p>
      </div>
      <div className="authfooter">Made for the everyday work behind every great print.</div>
    </div>
  );
}

function Composer({
  mode,
  data,
  cfg,
  busy,
  error,
  onClose,
  onSave,
}: {
  mode: 'sale' | 'invoice';
  data: Data;
  cfg: Settings;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>([
      { product_id: null, description: '', quantity: 1, unit_price: 0 },
    ]),
    [discount, setDiscount] = useState(0),
    [tax, setTax] = useState(Number(cfg.tax_rate)),
    [method, setMethod] = useState(mode === 'sale' ? 'cash' : 'invoice'),
    [productSearch, setProductSearch] = useState(''),
    [localError, setLocalError] = useState('');
  const [requestId, setRequestId] = useState(uid);
  const calc = useMemo(() => {
    try {
      return totals(lines, discount, tax);
    } catch {
      return null;
    }
  }, [lines, discount, tax]);
  const changeLine = (index: number, change: Partial<Line>) => {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...change } : l)));
    setRequestId(uid());
  };
  return (
    <Modal
      title={mode === 'sale' ? 'New sale' : 'New invoice'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <InvoiceBranding settings={cfg} />
      <form
        onSubmit={(e) => {
          const f = formValues(e);
          setLocalError('');
          try {
            totals(lines, discount, tax);
            if (method === 'invoice' && !f.customer_id && f.intent !== 'draft')
              throw new Error('Select a customer for invoice / credit.');
            void onSave({
              ...f,
              lines,
              discount,
              tax_rate: tax,
              method,
              draft: f.intent === 'draft',
              request_id: requestId,
            });
          } catch (err) {
            setLocalError(errText(err));
          }
        }}
      >
        {(error || localError) && (
          <div className="alert error" role="alert">
            {localError || error}
          </div>
        )}
        <div className="formgrid">
          <Field label="Customer">
            <select
              name="customer_id"
              required={method === 'invoice'}
              onChange={() => setRequestId(uid())}
            >
              <option value="">Walk-in customer</option>
              {data.customers
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Payment method">
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                setRequestId(uid());
              }}
            >
              {['cash', 'gcash', 'bank transfer', 'invoice'].map((m) => (
                <option key={m} value={m}>
                  {m === 'invoice'
                    ? 'Invoice / credit'
                    : m === 'gcash'
                      ? 'GCash'
                      : m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Issue date">
            <input
              name="issue_date"
              type="date"
              required
              defaultValue={today()}
              onChange={() => setRequestId(uid())}
            />
          </Field>
          <Field label="Due date">
            <input
              name="due_date"
              type="date"
              required
              defaultValue={datePlus(cfg.payment_terms_days)}
              onChange={() => setRequestId(uid())}
            />
          </Field>
        </div>
        <div className="lineheading">
          <h3>Items & services</h3>
          <button
            className="link"
            type="button"
            onClick={() => {
              setLines([
                ...lines,
                { product_id: null, description: '', quantity: 1, unit_price: 0 },
              ]);
              setRequestId(uid());
            }}
          >
            + Custom item
          </button>
        </div>
        <Field label="Find a catalog item">
          <input
            type="search"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Search products or services…"
          />
        </Field>
        <div className="catalog">
          {data.products
            .filter(
              (p) =>
                p.active &&
                `${p.name} ${p.sku}`.toLowerCase().includes(productSearch.toLowerCase()),
            )
            .slice(0, 12)
            .map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  const l = {
                    product_id: p.id,
                    description: p.name,
                    quantity: 1,
                    unit_price: Number(p.price),
                  };
                  setLines((ls) => (ls.length === 1 && !ls[0].description ? [l] : [...ls, l]));
                  setRequestId(uid());
                }}
              >
                <span>
                  {p.name}
                  <small>{p.track_stock ? `${p.quantity} ${p.unit} available` : 'Service'}</small>
                </span>
                <b>{money(p.price)}</b>
              </button>
            ))}
        </div>
        {lines.map((l, index) => (
          <div className="lineitem" key={index}>
            <Field label={`Item ${index + 1} description`}>
              <input
                required
                value={l.description}
                maxLength={500}
                onChange={(e) => changeLine(index, { description: e.target.value })}
              />
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                min="0.001"
                step="0.001"
                required
                value={l.quantity}
                onChange={(e) => changeLine(index, { quantity: Number(e.target.value) })}
              />
            </Field>
            <Field label="Unit price (PHP)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={l.unit_price}
                onChange={(e) => changeLine(index, { unit_price: Number(e.target.value) })}
              />
            </Field>
            <button
              type="button"
              className="iconbtn"
              aria-label={`Remove item ${index + 1}`}
              disabled={lines.length === 1}
              onClick={() => {
                setLines(lines.filter((_, i) => i !== index));
                setRequestId(uid());
              }}
            >
              <X size={17} />
            </button>
          </div>
        ))}
        <div className="formgrid">
          <Field label="Discount (PHP)">
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={discount}
              onChange={(e) => {
                setDiscount(Number(e.target.value));
                setRequestId(uid());
              }}
            />
          </Field>
          <Field label={`${cfg.tax_label} (%)`}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={tax}
              onChange={(e) => {
                setTax(Number(e.target.value));
                setRequestId(uid());
              }}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea name="notes" rows={2} onChange={() => setRequestId(uid())} />
        </Field>
        {cfg.terms && (
          <div className="invoice-terms">
            <h3>Invoice terms</h3>
            <p>{cfg.terms}</p>
          </div>
        )}
        <div className="checkout">
          <span>
            Subtotal <b>{money(calc?.subtotal || 0)}</b>
          </span>
          <span>
            Discount <b>− {money(discount)}</b>
          </span>
          <span>
            {cfg.tax_label} <b>{money(calc?.tax || 0)}</b>
          </span>
          <strong>
            Total <b>{money(calc?.total || 0)}</b>
          </strong>
        </div>
        <p className="muted">
          Stock is validated and deducted on issue. Credit invoices require a customer. All prices
          are in PHP.
        </p>
        <div className="modalfoot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {mode === 'invoice' && (
            <button
              name="intent"
              value="draft"
              className="btn"
              disabled={busy}
              onClick={(e) => {
                const form = e.currentTarget.form!;
                let input = form.querySelector<HTMLInputElement>('input[name="intent"]');
                if (!input) {
                  input = document.createElement('input');
                  input.type = 'hidden';
                  input.name = 'intent';
                  form.append(input);
                }
                input.value = 'draft';
              }}
            >
              Save draft
            </button>
          )}
          <button
            className="btn primary"
            disabled={busy || !calc}
            onClick={(e) => {
              const input =
                e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="intent"]');
              if (input) input.value = 'issue';
            }}
          >
            {busy ? 'Saving…' : mode === 'sale' ? 'Complete sale' : 'Issue invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EntityForm({
  edit,
  data,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  edit: Edit;
  data: Data;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const record = (edit.record || {}) as unknown as Record<string, string | number | boolean>;
  const requestId = useRef(uid());
  const input = (name: string, label: string, type = 'text', required = false) => (
    <Field label={label}>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={String(record[name] ?? '')}
        {...(type === 'number'
          ? { min: 0, step: name === 'reorder_threshold' ? '0.001' : '0.01' }
          : { maxLength: 1000 })}
      />
    </Field>
  );
  const active = (
    <Field label="Status">
      <select name="active" defaultValue={String(record.active ?? true)}>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </Field>
  );
  return (
    <Modal
      title={
        edit.kind === 'payment'
          ? `Record payment · ${(edit.record as Invoice).number}`
          : edit.kind === 'adjust'
            ? 'Stock adjustment'
            : edit.kind === 'invite'
              ? 'Add team member'
              : edit.kind === 'password'
                ? `Set password · ${(edit.record as Profile).display_name}`
                : `${edit.record ? 'Edit' : 'Add'} ${edit.kind}`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={onSubmit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="formgrid">
          {edit.kind === 'customer' && (
            <>
              {input('name', 'Customer name', 'text', true)}
              {input('email', 'Email', 'email')}
              {input('phone', 'Phone', 'tel')}
              {input('billing_address', 'Billing address')}
              {input('notes', 'Notes')}
              {active}
            </>
          )}
          {edit.kind === 'product' && (
            <>
              {input('name', 'Product / service name', 'text', true)}
              {input('sku', 'SKU', 'text', true)}
              {input('category', 'Category')}
              {input('unit', 'Unit', 'text', true)}
              {input('price', 'Sale price (PHP)', 'number', true)}
              {input('cost', 'Unit cost (PHP)', 'number', true)}
              {input('reorder_threshold', 'Reorder threshold', 'number', true)}
              {!edit.record && (
                <Field label="Item type">
                  <select name="track_stock">
                    <option value="true">Tracked product / material</option>
                    <option value="false">Service (no stock)</option>
                  </select>
                </Field>
              )}
              {active}
              <p className="muted">
                New products start with zero stock. Use Stock adjustment to record opening stock
                with an audit trail.
              </p>
            </>
          )}
          {edit.kind === 'expense' && (
            <>
              {input('description', 'Description', 'text', true)}
              <Field label="Category">
                <select name="category_id" defaultValue={String(record.category_id || '')} required>
                  <option value="" disabled>
                    Select category
                  </option>
                  {data.expense_categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Expense date">
                <input
                  name="expense_date"
                  type="date"
                  defaultValue={String(record.expense_date || today())}
                  required
                />
              </Field>
              <Field label="Amount (PHP)">
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={String(record.amount || '')}
                  required
                />
              </Field>
              {input('vendor', 'Vendor / payee')}
              {input('receipt_reference', 'Receipt reference')}
              {input('notes', 'Notes')}
              <p className="muted">
                Keep the original receipt and enter its reference here. Changes are audited.
              </p>
            </>
          )}
          {edit.kind === 'category' && input('name', 'Category name', 'text', true)}
          {edit.kind === 'adjust' && (
            <>
              <Field label="Tracked product">
                <select name="product_id" required>
                  <option value="">Select product</option>
                  {data.products
                    .filter((p) => p.track_stock)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.quantity} {p.unit}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Quantity change (+ in / − out)">
                <input name="delta" type="number" step="0.001" required />
              </Field>
              <Field label="Reason">
                <textarea name="reason" required minLength={3} />
              </Field>
              <p className="muted">
                Use a negative quantity for stock out. Each adjustment is permanently recorded.
              </p>
            </>
          )}
          {edit.kind === 'invite' && (
            <>
              {input('display_name', 'Full name', 'text', true)}
              {input('email', 'Email address', 'email', true)}
              <Field label="Role">
                <select name="role">
                  {['Staff', 'Cashier', 'Accountant', 'Administrator'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <p className="muted">Email is used as a login name. No verification email is sent.</p>
            </>
          )}
          {(edit.kind === 'invite' || edit.kind === 'password') && (
            <>
              <Field label={edit.kind === 'invite' ? 'Initial password' : 'New password'}>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                />
              </Field>
              <Field label="Confirm password">
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                />
              </Field>
              <p className="muted">
                At least 12 characters. Passwords are never displayed or stored in shop records.
                Share the new password securely.
              </p>
            </>
          )}
          {edit.kind === 'payment' && (
            <>
              <input type="hidden" name="request_id" value={requestId.current} />
              <Field label="Amount (PHP)">
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={balanceDue(
                    { id: String(record.id), total: Number(record.total) },
                    data.payments,
                  )}
                  required
                />
              </Field>
              <Field label="Payment method">
                <select name="method">
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="bank transfer">Bank transfer</option>
                </select>
              </Field>
              {input('reference', 'Payment reference')}
              <p className="muted">
                Balance:{' '}
                {money(
                  balanceDue({ id: String(record.id), total: Number(record.total) }, data.payments),
                )}
                . Payment records are permanent.
              </p>
            </>
          )}
        </div>
        <div className="modalfoot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy
              ? 'Saving…'
              : edit.kind === 'invite'
                ? 'Create user'
                : edit.kind === 'password'
                  ? 'Set password'
                  : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceDetail({
  invoice: i,
  data,
  cfg,
  role,
  busy,
  onClose,
  onPay,
  onVoid,
  onIssue,
  notify,
  onError,
}: {
  invoice: Invoice;
  data: Data;
  cfg: Settings;
  role: Role;
  busy: boolean;
  onClose: () => void;
  onPay: () => void;
  onVoid: () => void;
  onIssue: () => void;
  notify: (s: string) => void;
  onError: (s: string) => void;
}) {
  const items = data.invoice_items.filter((l) => l.invoice_id === i.id);
  const payments = data.payments.filter((p) => p.invoice_id === i.id);
  const paid = paidAmount(i.id, payments);
  const pdf = () => invoicePdf(i, items, payments, cfg);
  return (
    <Modal title={i.number} onClose={onClose}>
      <InvoiceBranding settings={cfg} />
      <div className="invoice-heading">
        <div>
          <h3>{i.customer_name}</h3>
          <p>
            {i.customer_email}
            <br />
            {i.billing_address}
          </p>
        </div>
        <Badge>{i.status}</Badge>
      </div>
      <p className="muted">
        Issued {i.issue_date} · Due {i.due_date}
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>{money(l.unit_price)}</td>
                <td>{money(lineAmount(l.quantity, l.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="checkout">
        <span>
          Subtotal<b>{money(i.subtotal)}</b>
        </span>
        <span>
          Discount<b>{money(i.discount)}</b>
        </span>
        <span>
          {i.tax_label} ({i.tax_rate}%)<b>{money(i.total - i.subtotal + i.discount)}</b>
        </span>
        <span>
          Total<b>{money(i.total)}</b>
        </span>
        <span>
          Paid<b>{money(paid)}</b>
        </span>
        <strong>
          Balance<b>{money(Math.max(0, i.total - paid))}</b>
        </strong>
      </div>
      <p>{i.notes}</p>
      <p className="muted">{i.terms}</p>
      <h3>Payment history</h3>
      {payments.length ? (
        <div className="paymentlist">
          {payments.map((p) => (
            <div key={p.id}>
              <div>
                <strong>{money(p.amount)}</strong> · {p.method}
                <small>
                  {new Date(p.created_at).toLocaleString('en-PH', { timeZone: cfg.timezone })} ·{' '}
                  {p.reference || 'No reference'}
                </small>
              </div>
              <Badge>recorded</Badge>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No payments recorded.</Empty>
      )}
      <div className="modalfoot wrap">
        <button className="btn" onClick={() => pdf().save(`${i.number}.pdf`)}>
          <Download size={15} />
          PDF
        </button>
        <button
          className="btn"
          onClick={() => {
            const url = URL.createObjectURL(pdf().output('blob'));
            const w = window.open(url, '_blank');
            if (!w) onError('Allow pop-ups to open the printable PDF.');
            else {
              w.addEventListener('load', () => w.print(), { once: true });
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }}
        >
          <Printer size={15} />
          Print
        </button>
        <button
          className="btn"
          onClick={() =>
            void shareInvoice(pdf(), i.number)
              .then((s) => notify(s))
              .catch((e) => {
                if (!(e instanceof Error && e.name === 'AbortError')) onError(errText(e));
              })
          }
        >
          <Share2 size={15} />
          Share
        </button>
        {i.status === 'draft' && can(role, 'invoice') && (
          <button className="btn primary" disabled={busy} onClick={onIssue}>
            Issue invoice
          </button>
        )}
        {!['paid', 'draft', 'void'].includes(i.status) && can(role, 'pay') && (
          <button className="btn primary" onClick={onPay}>
            Record payment
          </button>
        )}
        {!['void'].includes(i.status) &&
          paid === 0 &&
          (role === 'Administrator' || role === 'Accountant') && (
            <button className="btn danger" onClick={onVoid}>
              Void
            </button>
          )}
      </div>
    </Modal>
  );
}

function SalesChart({ sales, end }: { sales: Data['sales']; end: string }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(`${end}T12:00:00+08:00`);
    d.setDate(d.getDate() - 6 + index);
    const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    return {
      label: d.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
      value: sales
        .filter(
          (s) =>
            new Date(s.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) ===
            date,
        )
        .reduce((sum, s) => sum + Number(s.total), 0),
    };
  });
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div
      className="chart"
      role="img"
      aria-label={days.map((d) => `${d.label}: ${money(d.value)}`).join(', ')}
    >
      {days.map((d, n) => (
        <div className="barcol" key={n}>
          <span className="barvalue">{money(d.value)}</span>
          <div
            className={`bar ${n === 6 ? 'active' : ''}`}
            style={{ height: `${Math.max(2, (d.value / max) * 145)}px` }}
          />
          <span className="barlabel">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
function ServiceMix({ data, invoiceIds }: { data: Data; invoiceIds: string[] }) {
  const amounts = new Map<string, number>();
  for (const l of data.invoice_items.filter((l) => invoiceIds.includes(l.invoice_id))) {
    const label = data.products.find((p) => p.id === l.product_id)?.category || 'Other';
    amounts.set(label, (amounts.get(label) || 0) + l.quantity * l.unit_price);
  }
  const entries = [...amounts].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  return entries.length ? (
    <div>
      {entries.slice(0, 5).map(([label, value], i) => (
        <div key={label} className="mixrow">
          <div>
            <span>{label}</span>
            <strong>{money(value)}</strong>
          </div>
          <div className="mixbar">
            <i
              style={{
                width: `${total ? (value / total) * 100 : 0}%`,
                background: ['#3569e8', '#73a4ff', '#a3b8ec', '#bbc9e8', '#c9d1e4'][i],
              }}
            />
          </div>
        </div>
      ))}
      <small className="muted">Gross item sales before discounts and tax.</small>
    </div>
  ) : (
    <Empty>No sales in the selected period.</Empty>
  );
}
