-- All financial mutations run inside a PostgreSQL transaction through these RPCs.
create type public.shop_role as enum ('Administrator','Cashier','Staff','Accountant');
create table public.shops (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.profiles (id uuid primary key references auth.users(id), shop_id uuid not null references public.shops(id), display_name text not null, email text not null, role public.shop_role not null default 'Staff', active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index profiles_shop_idx on public.profiles(shop_id);
create table public.shop_settings (shop_id uuid primary key references public.shops(id), business_name text not null, email text not null default '', phone text not null default '', address text not null default '', logo_url text not null default '', currency text not null default 'PHP' check(currency='PHP'), invoice_prefix text not null default 'INV' check(invoice_prefix ~ '^[A-Za-z0-9-]{1,24}$'), payment_terms_days integer not null default 15 check(payment_terms_days between 0 and 365), tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100), tax_label text not null default 'Tax', terms text not null default '', brand_color text not null default '#3569e8' check(brand_color ~ '^#[0-9a-fA-F]{6}$'), timezone text not null default 'Asia/Manila' check(timezone='Asia/Manila'), updated_at timestamptz not null default now());
create table public.invoice_sequences (shop_id uuid primary key references public.shops(id), last_value bigint not null default 0 check(last_value>=0));
create table public.customers (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), name text not null check(length(trim(name))>0), email text not null default '', phone text not null default '', billing_address text not null default '', notes text not null default '', active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,shop_id));
create table public.products (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), name text not null check(length(trim(name))>0), sku text not null, category text not null default '', unit text not null default 'pc', price numeric(14,2) not null check(price>=0), cost numeric(14,2) not null default 0 check(cost>=0), quantity numeric(14,3) not null default 0 check(quantity>=0), reorder_threshold numeric(14,3) not null default 0 check(reorder_threshold>=0), track_stock boolean not null default true, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(shop_id,sku), unique(id,shop_id));
create table public.invoices (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), request_id uuid not null, number text not null, customer_id uuid, customer_name text not null, customer_email text not null default '', billing_address text not null default '', business_details jsonb not null, issue_date date not null, due_date date not null, discount numeric(14,2) not null check(discount>=0), tax_rate numeric(5,2) not null check(tax_rate between 0 and 100), tax_label text not null, subtotal numeric(14,2) not null check(subtotal>=0), total numeric(14,2) not null check(total>=0), status text not null check(status in ('draft','pending','partially paid','paid','overdue','void')), notes text not null default '', terms text not null default '', created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(shop_id,number), unique(shop_id,request_id), unique(id,shop_id), foreign key(customer_id,shop_id) references public.customers(id,shop_id), check(due_date>=issue_date), check(discount<=subtotal));
create table public.invoice_items (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), invoice_id uuid not null, product_id uuid, description text not null check(length(trim(description))>0), quantity numeric(14,3) not null check(quantity>0), unit_price numeric(14,2) not null check(unit_price>=0), foreign key(invoice_id,shop_id) references public.invoices(id,shop_id), foreign key(product_id,shop_id) references public.products(id,shop_id));
create table public.sales (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), invoice_id uuid not null unique, customer_id uuid, total numeric(14,2) not null check(total>=0), method text not null check(method in ('cash','gcash','bank transfer','invoice')), status text not null default 'completed' check(status in ('completed','void')), created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(id,shop_id), foreign key(invoice_id,shop_id) references public.invoices(id,shop_id), foreign key(customer_id,shop_id) references public.customers(id,shop_id));
create table public.sale_items (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), sale_id uuid not null, product_id uuid, description text not null, quantity numeric(14,3) not null check(quantity>0), unit_price numeric(14,2) not null check(unit_price>=0), foreign key(sale_id,shop_id) references public.sales(id,shop_id), foreign key(product_id,shop_id) references public.products(id,shop_id));
-- Payments are allocated ONLY to invoices. Sales totals are revenue; payments are collections.
create table public.payments (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), invoice_id uuid not null, request_id uuid not null, amount numeric(14,2) not null check(amount>0), method text not null check(method in ('cash','gcash','bank transfer')), reference text not null default '', created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(shop_id,request_id), foreign key(invoice_id,shop_id) references public.invoices(id,shop_id));
create table public.expense_categories (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), name text not null check(length(trim(name))>0), unique(shop_id,name), unique(id,shop_id));
create table public.expenses (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), description text not null check(length(trim(description))>0), category_id uuid not null, vendor text not null default '', amount numeric(14,2) not null check(amount>0), expense_date date not null, notes text not null default '', receipt_reference text not null default '', created_by uuid not null default auth.uid() references public.profiles(id), status text not null default 'active' check(status in ('active','void')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(category_id,shop_id) references public.expense_categories(id,shop_id));
create table public.stock_movements (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), product_id uuid not null, invoice_id uuid, delta numeric(14,3) not null check(delta<>0), reason text not null check(length(trim(reason))>0), created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), foreign key(product_id,shop_id) references public.products(id,shop_id), foreign key(invoice_id,shop_id) references public.invoices(id,shop_id));
create table public.audit_logs (id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), actor_id uuid references public.profiles(id), action text not null, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now());
create index customers_shop_idx on public.customers(shop_id);
create index products_shop_idx on public.products(shop_id);
create index invoices_shop_date_idx on public.invoices(shop_id,issue_date);
create index invoices_customer_idx on public.invoices(customer_id);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);
create index payments_invoice_idx on public.payments(invoice_id);
create index sales_shop_date_idx on public.sales(shop_id,created_at);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index expenses_shop_date_idx on public.expenses(shop_id,expense_date);
create index movements_product_idx on public.stock_movements(product_id,created_at);
create index movements_invoice_idx on public.stock_movements(invoice_id);
create index audit_shop_idx on public.audit_logs(shop_id,created_at);
-- PostgreSQL numeric supports NaN; reject it explicitly on every business quantity.
alter table public.products add constraint products_finite check(price<>'NaN'::numeric and cost<>'NaN'::numeric and quantity<>'NaN'::numeric and reorder_threshold<>'NaN'::numeric);
alter table public.shop_settings add constraint settings_finite check(tax_rate<>'NaN'::numeric);
alter table public.shop_settings add constraint settings_logo check(length(logo_url)<=700000 and (logo_url='' or logo_url ~ '^data:image/(png|jpeg);base64,'));
alter table public.invoices add constraint invoices_finite check(discount<>'NaN'::numeric and tax_rate<>'NaN'::numeric and subtotal<>'NaN'::numeric and total<>'NaN'::numeric);
alter table public.invoice_items add constraint invoice_items_finite check(quantity<>'NaN'::numeric and unit_price<>'NaN'::numeric);
alter table public.sales add constraint sales_finite check(total<>'NaN'::numeric);
alter table public.sale_items add constraint sale_items_finite check(quantity<>'NaN'::numeric and unit_price<>'NaN'::numeric);
alter table public.payments add constraint payments_finite check(amount<>'NaN'::numeric);
alter table public.expenses add constraint expenses_finite check(amount<>'NaN'::numeric);
alter table public.stock_movements add constraint movements_finite check(delta<>'NaN'::numeric);

create function public.has_role(s uuid, roles public.shop_role[] default array['Administrator','Cashier','Staff','Accountant']::public.shop_role[]) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.shop_id=s and p.active and p.role=any(roles)); $$;
create function public.require_role(s uuid, roles public.shop_role[]) returns void language plpgsql stable security definer set search_path='' as $$ begin if not public.has_role(s,roles) then raise exception 'Permission denied' using errcode='42501'; end if; end $$;

do $$ declare t text; begin foreach t in array array['shops','profiles','shop_settings','invoice_sequences','customers','products','invoices','invoice_items','sales','sale_items','payments','expense_categories','expenses','stock_movements','audit_logs'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); end loop; end $$;
grant select on public.shops,public.profiles,public.shop_settings,public.customers,public.products,public.invoices,public.invoice_items,public.sales,public.sale_items,public.payments,public.expense_categories,public.expenses,public.stock_movements,public.audit_logs to authenticated;
create policy shops_read on public.shops for select to authenticated using(public.has_role(id));
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.has_role(shop_id,array['Administrator']::public.shop_role[]));
do $$ declare t text; begin foreach t in array array['shop_settings','customers','products','invoices','invoice_items','sales','sale_items','payments','expense_categories','stock_movements'] loop execute format('create policy member_read on public.%I for select to authenticated using(public.has_role(shop_id))',t); end loop; end $$;
create policy expenses_read on public.expenses for select to authenticated using(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));
create policy audit_read on public.audit_logs for select to authenticated using(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));
grant insert,update on public.customers,public.expense_categories,public.expenses to authenticated;
grant insert (id,shop_id,name,sku,category,unit,price,cost,reorder_threshold,track_stock,active), update(name,sku,category,unit,price,cost,reorder_threshold,active) on public.products to authenticated;
grant update(business_name,email,phone,address,logo_url,invoice_prefix,payment_terms_days,tax_rate,tax_label,terms,brand_color) on public.shop_settings to authenticated;
create policy customer_insert on public.customers for insert to authenticated with check(public.has_role(shop_id));
create policy customer_update on public.customers for update to authenticated using(public.has_role(shop_id)) with check(public.has_role(shop_id));
create policy product_insert on public.products for insert to authenticated with check(public.has_role(shop_id,array['Administrator','Staff']::public.shop_role[]));
create policy product_update on public.products for update to authenticated using(public.has_role(shop_id,array['Administrator','Staff']::public.shop_role[])) with check(public.has_role(shop_id,array['Administrator','Staff']::public.shop_role[]));
create policy settings_update on public.shop_settings for update to authenticated using(public.has_role(shop_id,array['Administrator']::public.shop_role[])) with check(public.has_role(shop_id,array['Administrator']::public.shop_role[]));
create policy category_insert on public.expense_categories for insert to authenticated with check(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));
create policy category_update on public.expense_categories for update to authenticated using(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[])) with check(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));
create policy expense_insert on public.expenses for insert to authenticated with check(created_by=auth.uid() and public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));
create policy expense_update on public.expenses for update to authenticated using(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[])) with check(public.has_role(shop_id,array['Administrator','Accountant']::public.shop_role[]));

create function public.audit_mutation() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_OP='UPDATE' then
   if new.shop_id<>old.shop_id or new.id<>old.id or new.created_at<>old.created_at then raise exception 'Identity cannot change'; end if;
   if TG_TABLE_NAME='expenses' then
    if new.created_by<>old.created_by then raise exception 'Creator cannot change'; end if;
   end if;
   new.updated_at=now();
 end if;
 if TG_TABLE_NAME='expenses' and TG_OP='UPDATE' then
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(new.shop_id,auth.uid(),'Expense updated',new.id,jsonb_build_object('before',jsonb_build_object('amount',old.amount,'expense_date',old.expense_date,'category_id',old.category_id,'status',old.status),'after',jsonb_build_object('amount',new.amount,'expense_date',new.expense_date,'category_id',new.category_id,'status',new.status)));
 else insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(new.shop_id,auth.uid(),TG_TABLE_NAME||' '||TG_OP,new.id); end if;
 return new;
end $$;
create trigger customers_audit before insert or update on public.customers for each row execute function public.audit_mutation();
create trigger products_audit before insert or update on public.products for each row execute function public.audit_mutation();
create trigger expenses_audit before insert or update on public.expenses for each row execute function public.audit_mutation();
create function public.audit_settings() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.shop_id<>old.shop_id then raise exception 'Shop identity cannot change'; end if;
 new.updated_at=now();
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(new.shop_id,auth.uid(),'Settings updated',new.shop_id,jsonb_build_object('old_tax_rate',old.tax_rate,'new_tax_rate',new.tax_rate,'old_prefix',old.invoice_prefix,'new_prefix',new.invoice_prefix));
 return new;
end $$;
create trigger settings_audit before update on public.shop_settings for each row execute function public.audit_settings();

create function public.adjust_stock(p_product_id uuid,p_delta numeric,p_reason text) returns void language plpgsql security definer set search_path='' as $$ declare p public.products; begin
 select * into strict p from public.products where id=p_product_id for update;
 perform public.require_role(p.shop_id,array['Administrator','Staff']::public.shop_role[]);
 if not p.track_stock or p_delta=0 or p_delta is null or p_delta<>round(p_delta,3) or p.quantity+p_delta<0 or length(trim(p_reason))=0 or p_reason is null then raise exception 'Invalid stock adjustment'; end if;
 update public.products set quantity=quantity+p_delta where id=p.id;
 insert into public.stock_movements(shop_id,product_id,delta,reason,created_by) values(p.shop_id,p.id,p_delta,p_reason,auth.uid());
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(p.shop_id,auth.uid(),'Stock adjusted',p.id,jsonb_build_object('delta',p_delta,'reason',p_reason));
end $$;

-- Internal helpers are explicitly revoked from API roles below.
create function public.post_invoice_internal(p_id uuid,p_method text) returns void language plpgsql security definer set search_path='' as $$ declare i public.invoices; l record; p public.products; sid uuid; begin
 select * into strict i from public.invoices where id=p_id for update;
 if i.status<>'draft' then raise exception 'Invoice is already issued'; end if;
 if p_method not in ('cash','gcash','bank transfer','invoice') then raise exception 'Invalid method'; end if;
 if p_method='invoice' and i.customer_id is null then raise exception 'Credit invoices require a customer'; end if;
 -- Lock products in UUID order to prevent competing checkouts from deadlocking.
 for l in select product_id,sum(quantity) qty from public.invoice_items where invoice_id=i.id and product_id is not null group by product_id order by product_id loop
 select * into strict p from public.products where id=l.product_id and shop_id=i.shop_id for update;
 if not p.active then raise exception 'Product is inactive: %',p.name; end if;
 if p.track_stock then
 if p.quantity<l.qty then raise exception 'Insufficient stock: %',p.name; end if;
 update public.products set quantity=quantity-l.qty where id=p.id;
 insert into public.stock_movements(shop_id,product_id,invoice_id,delta,reason,created_by) values(i.shop_id,p.id,i.id,-l.qty,'Invoice '||i.number,auth.uid());
 end if; end loop;
 update public.invoices set status=case when total=0 then 'paid' else 'pending' end,updated_at=now() where id=i.id;
 insert into public.sales(shop_id,invoice_id,customer_id,total,method,created_by) values(i.shop_id,i.id,i.customer_id,i.total,p_method,auth.uid()) returning id into sid;
 insert into public.sale_items(shop_id,sale_id,product_id,description,quantity,unit_price) select shop_id,sid,product_id,description,quantity,unit_price from public.invoice_items where invoice_id=i.id;
 if p_method<>'invoice' and i.total>0 then
 insert into public.payments(shop_id,invoice_id,request_id,amount,method,created_by) values(i.shop_id,i.id,gen_random_uuid(),i.total,p_method,auth.uid());
 update public.invoices set status='paid' where id=i.id;
 end if;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(i.shop_id,auth.uid(),'Invoice issued',i.id);
end $$;

create function public.create_document(p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid; c public.customers; cfg public.shop_settings; seq bigint; iid uuid; l jsonb; sub numeric=0; disc numeric; rate numeric; ttl numeric; cust uuid; issue date; due date; req uuid; method text; isdraft boolean; begin
 s=(p_payload->>'shop_id')::uuid;
 perform public.require_role(s,array['Administrator','Cashier','Accountant']::public.shop_role[]);
 req=(p_payload->>'request_id')::uuid;
 -- Serialize retries of the same checkout, including simultaneous requests.
 perform pg_advisory_xact_lock(hashtextextended(s::text||req::text,0));
 select id into iid from public.invoices where shop_id=s and request_id=req;
 if iid is not null then return iid; end if;
 select * into strict cfg from public.shop_settings where shop_id=s;
 cust=nullif(p_payload->>'customer_id','')::uuid;
 if cust is not null then select * into strict c from public.customers where id=cust and shop_id=s and active; end if;
 if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines')<>'array' then raise exception 'Provide 1–200 line items'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'Provide 1–200 line items'; end if;
 for l in select * from jsonb_array_elements(p_payload->'lines') loop
 if length(trim(coalesce(l->>'description','')))=0 or (l->>'quantity')::numeric<=0 or (l->>'unit_price')::numeric<0 or (l->>'quantity') is null or (l->>'unit_price') is null or (l->>'quantity')::numeric<>round((l->>'quantity')::numeric,3) or (l->>'unit_price')::numeric<>round((l->>'unit_price')::numeric,2) then raise exception 'Invalid line item'; end if;
 sub=sub+round((l->>'quantity')::numeric*(l->>'unit_price')::numeric,2);
 end loop;
 disc=coalesce((p_payload->>'discount')::numeric,0); rate=coalesce((p_payload->>'tax_rate')::numeric,cfg.tax_rate);
 if disc<0 or disc>sub or disc<>round(disc,2) or rate<0 or rate>100 or rate<>round(rate,2) then raise exception 'Invalid discount or tax'; end if;
 ttl=sub-disc+round((sub-disc)*rate/100,2);
 issue=coalesce((p_payload->>'issue_date')::date,(now() at time zone cfg.timezone)::date); due=coalesce((p_payload->>'due_date')::date,issue+cfg.payment_terms_days);
 method=coalesce(p_payload->>'method','invoice'); isdraft=coalesce((p_payload->>'draft')::boolean,false);
 insert into public.invoice_sequences(shop_id,last_value) values(s,1) on conflict(shop_id) do update set last_value=public.invoice_sequences.last_value+1 returning last_value into seq;
 insert into public.invoices(shop_id,request_id,number,customer_id,customer_name,customer_email,billing_address,business_details,issue_date,due_date,discount,tax_rate,tax_label,subtotal,total,status,notes,terms,created_by)
 values(s,req,cfg.invoice_prefix||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0'),cust,coalesce(c.name,'Walk-in customer'),coalesce(c.email,''),coalesce(c.billing_address,''),to_jsonb(cfg),issue,due,disc,rate,cfg.tax_label,sub,ttl,'draft',coalesce(p_payload->>'notes',''),cfg.terms,auth.uid()) returning id into iid;
 for l in select * from jsonb_array_elements(p_payload->'lines') loop
 insert into public.invoice_items(shop_id,invoice_id,product_id,description,quantity,unit_price) values(s,iid,nullif(l->>'product_id','')::uuid,l->>'description',(l->>'quantity')::numeric,(l->>'unit_price')::numeric);
 end loop;
 if not isdraft then perform public.post_invoice_internal(iid,method); end if;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(s,auth.uid(),'Invoice created',iid);
 return iid;
end $$;

create function public.issue_invoice(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare s uuid; begin select shop_id into strict s from public.invoices where id=p_id; perform public.require_role(s,array['Administrator','Cashier','Accountant']::public.shop_role[]); perform public.post_invoice_internal(p_id,'invoice'); end $$;
create function public.record_payment(p_id uuid,p_amount numeric,p_method text,p_reference text,p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare i public.invoices; paid numeric; existing public.payments; begin
 select * into strict i from public.invoices where id=p_id for update;
 perform public.require_role(i.shop_id,array['Administrator','Cashier','Accountant']::public.shop_role[]);
 select * into existing from public.payments where shop_id=i.shop_id and request_id=p_request_id;
 if found then if existing.invoice_id<>p_id or existing.amount<>p_amount or existing.method<>p_method then raise exception 'Payment request conflict'; end if; return; end if;
 select coalesce(sum(amount),0) into paid from public.payments where invoice_id=i.id;
 if i.status in ('draft','void') or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>i.total-paid or p_method not in ('cash','gcash','bank transfer') then raise exception 'Invalid payment or payment exceeds balance'; end if;
 insert into public.payments(shop_id,invoice_id,request_id,amount,method,reference,created_by) values(i.shop_id,i.id,p_request_id,p_amount,p_method,coalesce(p_reference,''),auth.uid());
 update public.invoices set status=case when paid+p_amount=total then 'paid' when due_date<(now() at time zone 'Asia/Manila')::date then 'overdue' else 'partially paid' end,updated_at=now() where id=i.id;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(i.shop_id,auth.uid(),'Payment recorded',i.id,jsonb_build_object('amount',p_amount));
end $$;
create function public.void_invoice(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ declare i public.invoices; l record; begin
 select * into strict i from public.invoices where id=p_id for update;
 perform public.require_role(i.shop_id,array['Administrator','Accountant']::public.shop_role[]);
 if i.status='void' or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Provide a reason for a nonvoid invoice'; end if;
 if exists(select 1 from public.payments where invoice_id=i.id) then raise exception 'Paid invoices require an accountant-led refund process before voiding; payment history is preserved'; end if;
 for l in select product_id,-sum(delta) qty from public.stock_movements where invoice_id=i.id group by product_id order by product_id loop
 update public.products set quantity=quantity+l.qty where id=l.product_id;
 insert into public.stock_movements(shop_id,product_id,invoice_id,delta,reason,created_by) values(i.shop_id,l.product_id,i.id,l.qty,'Void: '||p_reason,auth.uid()); end loop;
 update public.invoices set status='void',updated_at=now() where id=i.id;
 update public.sales set status='void' where invoice_id=i.id;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(i.shop_id,auth.uid(),'Invoice voided',i.id,jsonb_build_object('reason',p_reason));
end $$;
create function public.manage_member(p_id uuid,p_role public.shop_role,p_active boolean) returns void language plpgsql security definer set search_path='' as $$ declare p public.profiles; begin
 select * into strict p from public.profiles where id=p_id;
 -- Serialize administrator changes per shop, preserving at least one active administrator.
 perform 1 from public.shops where id=p.shop_id for update;
 perform public.require_role(p.shop_id,array['Administrator']::public.shop_role[]);
 if p.id=auth.uid() then raise exception 'Administrators cannot change their own access'; end if;
 if p_role is null or p_active is null then raise exception 'Role and active state required'; end if;
 update public.profiles set role=p_role,active=p_active,updated_at=now() where id=p.id;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(p.shop_id,auth.uid(),'Member access changed',p.id,jsonb_build_object('old_role',p.role,'old_active',p.active,'role',p_role,'active',p_active));
end $$;

-- Safe default: no function automatically inherits API execution privileges.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.has_role(uuid,public.shop_role[]) to authenticated;
grant execute on function public.adjust_stock(uuid,numeric,text), public.create_document(jsonb),public.issue_invoice(uuid),public.record_payment(uuid,numeric,text,text,uuid),public.void_invoice(uuid,text),public.manage_member(uuid,public.shop_role,boolean) to authenticated;
-- Only the invite Edge Function uses this; no client may insert profiles.
create function public.provision_invited_member(p_id uuid,p_shop uuid,p_name text,p_email text,p_role public.shop_role,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.profiles where id=p_actor and shop_id=p_shop and role='Administrator' and active) then raise exception 'Administrator required'; end if;
 insert into public.profiles(id,shop_id,display_name,email,role) values(p_id,p_shop,p_name,p_email,p_role);
 insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(p_shop,p_actor,'Member invited',p_id);
end $$;
revoke all on function public.provision_invited_member(uuid,uuid,text,text,public.shop_role,uuid) from public,anon,authenticated;
grant execute on function public.provision_invited_member(uuid,uuid,text,text,public.shop_role,uuid) to service_role;
