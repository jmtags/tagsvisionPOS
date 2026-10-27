import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Real PostgreSQL (WASM) executes the production migration. Auth schemas/roles
// below emulate Supabase only; application functions and policies are unmodified.
const db = new PGlite();
const shop = '10000000-0000-0000-0000-000000000001',
  otherShop = '10000000-0000-0000-0000-000000000002';
const admin = '20000000-0000-0000-0000-000000000001',
  cashier = '20000000-0000-0000-0000-000000000002',
  staff = '20000000-0000-0000-0000-000000000003',
  accountant = '20000000-0000-0000-0000-000000000004',
  outsider = '20000000-0000-0000-0000-000000000005';
const product = '30000000-0000-0000-0000-000000000001',
  customer = '40000000-0000-0000-0000-000000000001';
const asUser = async (id: string) => {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
  );
};
const scalar = async <T>(sql: string, params: unknown[] = []) => {
  const q = await db.query<Record<string, T>>(sql, params);
  return Object.values(q.rows[0])[0];
};
const payload = (extra: Record<string, unknown> = {}) => ({
  shop_id: shop,
  request_id: crypto.randomUUID(),
  customer_id: customer,
  lines: [
    {
      product_id: product,
      description: 'Historical paper description',
      quantity: 2,
      unit_price: 50,
    },
  ],
  discount: 0,
  tax_rate: 0,
  method: 'invoice',
  issue_date: '2026-10-22',
  due_date: '2026-11-01',
  ...extra,
});
const create = (p = payload()) =>
  scalar<string>('select public.create_document($1::jsonb)', [JSON.stringify(p)]);
async function seed() {
  await db.exec(`reset role;
 truncate public.shops cascade;
 insert into public.shops(id,name) values('${shop}','Test shop'),('${otherShop}','Other shop');
 insert into auth.users(id) values('${admin}'),('${cashier}'),('${staff}'),('${accountant}'),('${outsider}') on conflict do nothing;
 insert into public.profiles(id,shop_id,display_name,email,role) values
 ('${admin}','${shop}','Owner','owner@test.invalid','Administrator'),('${cashier}','${shop}','Cashier','cashier@test.invalid','Cashier'),('${staff}','${shop}','Staff','staff@test.invalid','Staff'),('${accountant}','${shop}','Accountant','accountant@test.invalid','Accountant'),('${outsider}','${otherShop}','Other owner','other@test.invalid','Administrator');
 insert into public.shop_settings(shop_id,business_name) values('${shop}','Test Shop'),('${otherShop}','Other');
 insert into public.customers(id,shop_id,name) values('${customer}','${shop}','Customer');
 insert into public.products(id,shop_id,name,sku,price,cost,quantity) values('${product}','${shop}','Paper','PAPER',50,30,10);
 `);
  await asUser(admin);
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202610220001_initial.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202610220002_admin_staff_passwords.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202610270003_invoice_terms.sql', import.meta.url),
      'utf8',
    ),
  );
}, 60000);
beforeEach(seed);
afterAll(() => db.close());
describe('database transactions and ledger', () => {
  it('creates a copied draft with edited terms and independent numbering, payments and stock', async () => {
    const original = await create(
      payload({ notes: 'Original job', terms: 'Original agreed terms' }),
    );
    await scalar('select public.record_payment($1,25,$2,$3,$4)', [
      original,
      'cash',
      'Deposit',
      crypto.randomUUID(),
    ]);
    const copiedPayload = payload({
      draft: true,
      notes: 'Repeat job',
      terms: 'Repeat job terms',
      issue_date: '2026-11-03',
      due_date: '2026-11-18',
    });
    const copy = await create(copiedPayload);
    expect(copy).not.toBe(original);
    expect(await create(copiedPayload)).toBe(copy);
    expect(await scalar('select number from public.invoices where id=$1', [copy])).toBe(
      'INV-000002',
    );
    expect(await scalar('select terms from public.invoices where id=$1', [copy])).toBe(
      'Repeat job terms',
    );
    expect(await scalar('select terms from public.invoices where id=$1', [original])).toBe(
      'Original agreed terms',
    );
    expect(
      Number(await scalar('select count(*) from public.payments where invoice_id=$1', [copy])),
    ).toBe(0);
    expect(Number(await scalar('select quantity from public.products'))).toBe(8);
    await scalar('select public.issue_invoice($1)', [copy]);
    expect(Number(await scalar('select quantity from public.products'))).toBe(6);
  });
  it('allows explicitly blank invoice terms without changing shop defaults', async () => {
    await db.query('update public.shop_settings set terms=$1 where shop_id=$2', [
      'Shop default',
      shop,
    ]);
    const id = await create(payload({ terms: '' }));
    expect(await scalar('select terms from public.invoices where id=$1', [id])).toBe('');
    expect(await scalar('select terms from public.shop_settings where shop_id=$1', [shop])).toBe(
      'Shop default',
    );
  });
  it('persists multiline notes and snapshots configured terms when an invoice is created', async () => {
    const notes = 'Collect at reception.\nAsk for Jamie.';
    const terms = 'Pay within 15 days.\nKeep proof of payment.';
    await db.query('update public.shop_settings set terms=$1 where shop_id=$2', [terms, shop]);
    const id = await create(payload({ notes }));
    await db.query('update public.shop_settings set terms=$1 where shop_id=$2', [
      'New default',
      shop,
    ]);
    const result = await db.query('select notes, terms from public.invoices where id=$1', [id]);
    expect(result.rows).toEqual([{ notes, terms }]);
  });
  it('allocates sequential unique numbers and makes checkout retries idempotent', async () => {
    const p = payload();
    const first = await create(p);
    expect(await create(p)).toBe(first);
    await create();
    expect(
      (
        await db.query<{ number: string }>('select number from public.invoices order by number')
      ).rows.map((r) => r.number),
    ).toEqual(['INV-000001', 'INV-000002']);
    expect(Number(await scalar('select quantity from public.products'))).toBe(6);
  });
  it('rolls back numbering, sale and stock on oversell', async () => {
    await expect(
      create(
        payload({
          lines: [{ product_id: product, description: 'Paper', quantity: 11, unit_price: 50 }],
        }),
      ),
    ).rejects.toThrow('Insufficient stock');
    expect(Number(await scalar('select count(*) from public.invoices'))).toBe(0);
    expect(Number(await scalar('select quantity from public.products'))).toBe(10);
    await create();
    expect(await scalar('select number from public.invoices')).toBe('INV-000001');
  });
  it('aggregates duplicate product lines before stock validation', async () => {
    await expect(
      create(
        payload({
          lines: [
            { product_id: product, description: 'A', quantity: 6, unit_price: 1 },
            { product_id: product, description: 'B', quantity: 6, unit_price: 1 },
          ],
        }),
      ),
    ).rejects.toThrow('Insufficient stock');
  });
  it('allocates distinct increasing numbers for a burst of submitted orders', async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        create(
          payload({
            lines: [{ product_id: null, description: 'Service', quantity: 1, unit_price: 10 }],
          }),
        ),
      ),
    );
    expect(new Set(ids).size).toBe(8);
    expect(Number(await scalar('select count(distinct number) from public.invoices'))).toBe(8);
    expect(await scalar('select max(number) from public.invoices')).toBe('INV-000008');
  });
  it('records adjustment history and rejects stock removal beyond on-hand', async () => {
    await db.query('select public.adjust_stock($1,-3,$2)', [product, 'Damaged stock']);
    expect(Number(await scalar('select quantity from public.products'))).toBe(7);
    expect(Number(await scalar('select delta from public.stock_movements'))).toBe(-3);
    await expect(
      db.query('select public.adjust_stock($1,-8,$2)', [product, 'Too much']),
    ).rejects.toThrow('Invalid stock adjustment');
    expect(Number(await scalar('select quantity from public.products'))).toBe(7);
  });
  it('preserves multiple partial payments, rejects overpayment, and retries safely', async () => {
    const id = await create();
    const request = crypto.randomUUID();
    await db.query('select public.record_payment($1,25,$2,$3,$4)', [
      id,
      'gcash',
      'Deposit',
      request,
    ]);
    await db.query('select public.record_payment($1,25,$2,$3,$4)', [
      id,
      'gcash',
      'Deposit',
      request,
    ]);
    expect(await scalar('select status from public.invoices')).toBe('partially paid');
    await expect(
      db.query('select public.record_payment($1,76,$2,$3,$4)', [
        id,
        'cash',
        '',
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow('Invalid payment');
    await db.query('select public.record_payment($1,75,$2,$3,$4)', [
      id,
      'cash',
      'Balance',
      crypto.randomUUID(),
    ]);
    expect(await scalar('select status from public.invoices')).toBe('paid');
    expect(Number(await scalar('select count(*) from public.payments'))).toBe(2);
    await expect(db.query('select public.void_invoice($1,$2)', [id, 'Cancel'])).rejects.toThrow(
      'refund',
    );
  });
  it('drafts do not deduct stock; issuing and voiding append reversing movements', async () => {
    const id = await create(payload({ draft: true }));
    expect(Number(await scalar('select quantity from public.products'))).toBe(10);
    await db.query('select public.issue_invoice($1)', [id]);
    expect(Number(await scalar('select quantity from public.products'))).toBe(8);
    await db.query('select public.void_invoice($1,$2)', [id, 'Cancelled by customer']);
    expect(Number(await scalar('select quantity from public.products'))).toBe(10);
    expect(Number(await scalar('select count(*) from public.stock_movements'))).toBe(2);
    expect(await scalar('select status from public.sales')).toBe('void');
    await expect(db.query('select public.void_invoice($1,$2)', [id, 'Again'])).rejects.toThrow(
      'nonvoid',
    );
  });
  it('retains historical prices and customer billing after catalog changes', async () => {
    await create();
    await db.exec(
      `update public.products set price=999,name='New product name' where id='${product}';update public.customers set name='New customer name' where id='${customer}';`,
    );
    expect(await scalar('select description from public.invoice_items')).toBe(
      'Historical paper description',
    );
    expect(Number(await scalar('select unit_price from public.invoice_items'))).toBe(50);
    expect(await scalar('select customer_name from public.invoices')).toBe('Customer');
  });
  it('rejects malformed and empty documents on the server', async () => {
    await expect(create(payload({ lines: [] }))).rejects.toThrow('line items');
    await expect(create(payload({ lines: null }))).rejects.toThrow('line items');
    await expect(create(payload({ discount: 101 }))).rejects.toThrow('Invalid discount');
    await expect(
      create(
        payload({
          lines: [{ product_id: null, description: 'NaN', quantity: 1, unit_price: 'NaN' }],
        }),
      ),
    ).rejects.toThrow();
  });
  it('matches decimal totals for fractional quantities', async () => {
    await create(
      payload({
        lines: [{ product_id: null, description: 'Fraction', quantity: 1.005, unit_price: 1 }],
        method: 'cash',
      }),
    );
    expect(Number(await scalar('select total from public.invoices'))).toBe(1.01);
  });
});
describe('database authorization', () => {
  it('restricts staff provisioning/password audit RPCs to the server and checks actor/shop', async () => {
    await expect(
      db.query('select public.audit_staff_password_change($1,$2,$3)', [staff, admin, 'requested']),
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('select public.provision_staff_member($1,$2,$3,$4,$5,$6)', [
        staff,
        shop,
        'Staff',
        'staff@example.test',
        'Staff',
        admin,
      ]),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role;set role service_role;');
    await expect(
      db.query('select public.audit_staff_password_change($1,$2,$3)', [
        outsider,
        admin,
        'requested',
      ]),
    ).rejects.toThrow('Administrator required');
    await expect(
      db.query('select public.audit_staff_password_change($1,$2,$3)', [
        staff,
        cashier,
        'requested',
      ]),
    ).rejects.toThrow('Administrator required');
    await db.query('select public.audit_staff_password_change($1,$2,$3)', [
      staff,
      admin,
      'requested',
    ]);
    await asUser(admin);
    expect(
      Number(
        await scalar(
          "select count(*) from public.audit_logs where action='Staff password change requested'",
        ),
      ),
    ).toBe(1);
  });
  it('provisions a new staff profile and audits the role without password data', async () => {
    const id = crypto.randomUUID();
    await db.exec('reset role;');
    await db.query('insert into auth.users(id) values($1)', [id]);
    await db.exec('set role service_role;');
    await db.query('select public.provision_staff_member($1,$2,$3,$4,$5,$6)', [
      id,
      shop,
      'New staff',
      'new@example.test',
      'Cashier',
      admin,
    ]);
    await asUser(admin);
    expect(await scalar('select role from public.profiles where id=$1', [id])).toBe('Cashier');
    expect(
      await scalar(
        "select details from public.audit_logs where entity_id=$1 and action='Staff account created'",
        [id],
      ),
    ).toEqual({ role: 'Cashier' });
  });
  it('retains expense financial edits in audit history and enforces creator identity', async () => {
    const category = await scalar<string>(
      "insert into public.expense_categories(shop_id,name) values($1,'Supplies') returning id",
      [shop],
    );
    await asUser(accountant);
    const expense = await scalar<string>(
      "insert into public.expenses(shop_id,description,category_id,amount,expense_date) values($1,'Paper supply',$2,100,'2026-10-22') returning id",
      [shop, category],
    );
    await db.query('update public.expenses set amount=125 where id=$1', [expense]);
    const details = await scalar<{ before: { amount: number }; after: { amount: number } }>(
      "select details from public.audit_logs where entity_id=$1 and action='Expense updated'",
      [expense],
    );
    expect(Number(details.before.amount)).toBe(100);
    expect(Number(details.after.amount)).toBe(125);
    await expect(
      db.query('update public.expenses set created_by=$1 where id=$2', [admin, expense]),
    ).rejects.toThrow('Creator cannot change');
    await asUser(cashier);
    expect(Number(await scalar('select count(*) from public.expenses'))).toBe(0);
    await expect(
      db.query(
        "insert into public.expenses(shop_id,description,category_id,amount,expense_date) values($1,'No access',$2,10,'2026-10-22')",
        [shop, category],
      ),
    ).rejects.toThrow('row-level security');
  });
  it('prevents direct role, quantity, invoice, ledger and sequence writes', async () => {
    await asUser(cashier);
    for (const statement of [
      `update public.profiles set role='Administrator' where id='${cashier}'`,
      `update public.products set quantity=999 where id='${product}'`,
      `delete from public.stock_movements`,
      `delete from public.payments`,
      `update public.invoice_sequences set last_value=0`,
      `update public.invoices set total=0`,
    ])
      await expect(db.exec(statement)).rejects.toThrow('permission denied');
    await expect(
      db.query('select public.manage_member($1,$2,true)', [cashier, 'Administrator']),
    ).rejects.toThrow('Permission denied');
  });
  it('isolates shops in SELECT and RPC calls', async () => {
    await asUser(outsider);
    expect(Number(await scalar('select count(*) from public.products'))).toBe(0);
    await expect(create()).rejects.toThrow('Permission denied');
    await expect(
      db.query('select public.adjust_stock($1,1,$2)', [product, 'Opening stock']),
    ).rejects.toThrow('Permission denied');
  });
  it('enforces staff and cashier permissions in PostgreSQL', async () => {
    await asUser(staff);
    await expect(create()).rejects.toThrow('Permission denied');
    await db.query('select public.adjust_stock($1,3,$2)', [product, 'Delivery']);
    expect(Number(await scalar('select quantity from public.products'))).toBe(13);
    await asUser(cashier);
    await expect(
      db.query('select public.adjust_stock($1,1,$2)', [product, 'Delivery']),
    ).rejects.toThrow('Permission denied');
    await create();
    expect(Number(await scalar('select count(*) from public.sales'))).toBe(1);
  });
  it('deactivation revokes existing session access and admins cannot change themselves', async () => {
    await expect(
      db.query('select public.manage_member($1,$2,true)', [admin, 'Staff']),
    ).rejects.toThrow('own access');
    await db.query('select public.manage_member($1,$2,false)', [cashier, 'Cashier']);
    await asUser(cashier);
    expect(Number(await scalar('select count(*) from public.products'))).toBe(0);
    await expect(create()).rejects.toThrow('Permission denied');
  });
  it('restricts internal helpers and service-only provisioning', async () => {
    await expect(
      db.query('select public.post_invoice_internal($1,$2)', [crypto.randomUUID(), 'cash']),
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('select public.provision_invited_member($1,$2,$3,$4,$5,$6)', [
        cashier,
        shop,
        'Name',
        'email@test.invalid',
        'Administrator',
        admin,
      ]),
    ).rejects.toThrow('permission denied');
  });
});
