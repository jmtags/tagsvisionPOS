-- Edit unfinished invoices in one transaction; preserve complete revisions in audit_logs.
begin;
alter table public.invoices add column revision integer not null default 1 check(revision > 0);
create unique index invoice_edit_request_idx on public.audit_logs(shop_id,(details->>'request_id')) where action='Invoice edited';

create function public.edit_invoice(p_id uuid,p_version integer,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 i public.invoices; c public.customers; p public.products; l jsonb; req uuid;
 old_document jsonb; new_document jsonb; prior_edit public.audit_logs;
 sub numeric=0; disc numeric; rate numeric; ttl numeric; paid numeric;
 cust uuid; issue date; due date; wanted numeric; deducted numeric; delta numeric;
begin
 select * into strict i from public.invoices where id=p_id for update;
 perform public.require_role(i.shop_id,array['Administrator','Cashier','Accountant']::public.shop_role[]);
 req=(p_payload->>'request_id')::uuid;
 if req is null then raise exception 'Edit request ID required'; end if;
 select * into prior_edit from public.audit_logs where shop_id=i.shop_id and action='Invoice edited' and details->>'request_id'=req::text;
 if found then
   if prior_edit.entity_id<>i.id then raise exception 'Edit request conflict'; end if;
   return;
 end if;
 select coalesce(sum(amount),0) into paid from public.payments where invoice_id=i.id;
 if i.status in ('paid','void') or (i.status<>'draft' and paid>=i.total) then raise exception 'Completed or void invoices cannot be edited'; end if;
 if p_version is null or p_version<>i.revision then raise exception 'This invoice has changed. Close the editor, reload, and try again'; end if;
 if jsonb_typeof(p_payload->'lines') is distinct from 'array' then raise exception 'Provide 1-200 line items'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'Provide 1-200 line items'; end if;
 for l in select * from jsonb_array_elements(p_payload->'lines') loop
   if length(trim(coalesce(l->>'description','')))=0 or length(l->>'description')>500
     or l->>'quantity' is null or l->>'unit_price' is null
     or (l->>'quantity')::numeric<=0 or (l->>'quantity')::numeric='NaN'::numeric
     or (l->>'unit_price')::numeric<0 or (l->>'unit_price')::numeric='NaN'::numeric
     or (l->>'quantity')::numeric<>round((l->>'quantity')::numeric,3)
     or (l->>'unit_price')::numeric<>round((l->>'unit_price')::numeric,2) then raise exception 'Invalid line item'; end if;
   if nullif(l->>'product_id','') is not null and not exists(select 1 from public.products where id=(l->>'product_id')::uuid and shop_id=i.shop_id) then raise exception 'Product does not belong to this shop'; end if;
   sub=sub+round((l->>'quantity')::numeric*(l->>'unit_price')::numeric,2);
 end loop;
 disc=coalesce((p_payload->>'discount')::numeric,i.discount);
 rate=coalesce((p_payload->>'tax_rate')::numeric,i.tax_rate);
 if disc='NaN'::numeric or rate='NaN'::numeric or disc<0 or disc>sub or disc<>round(disc,2) or rate<0 or rate>100 or rate<>round(rate,2) then raise exception 'Invalid discount or tax'; end if;
 ttl=sub-disc+round((sub-disc)*rate/100,2);
 if ttl<paid then raise exception 'Invoice total cannot be less than payments already received'; end if;
 cust=nullif(p_payload->>'customer_id','')::uuid;
 if paid>0 and cust is distinct from i.customer_id then raise exception 'Customer cannot change after payments have been received'; end if;
 if cust is distinct from i.customer_id then
   if cust is not null then select * into strict c from public.customers where id=cust and shop_id=i.shop_id and active; end if;
 else
   c.name=i.customer_name; c.email=i.customer_email; c.billing_address=i.billing_address;
 end if;
 if i.status<>'draft' and cust is null then raise exception 'Credit invoices require a customer'; end if;
 issue=coalesce((p_payload->>'issue_date')::date,i.issue_date);
 due=coalesce((p_payload->>'due_date')::date,i.due_date);
 if due<issue then raise exception 'Due date cannot be earlier than issue date'; end if;
 select jsonb_build_object('invoice',to_jsonb(i),'items',coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)) into old_document from public.invoice_items x where invoice_id=i.id;

 -- Lock the union of old and new products in a stable order, including removed items.
 for p in select * from public.products where shop_id=i.shop_id and id in (
   select nullif(x->>'product_id','')::uuid from jsonb_array_elements(p_payload->'lines') x
   union select product_id from public.stock_movements where invoice_id=i.id
 ) order by id for update loop
   select coalesce(sum((x->>'quantity')::numeric),0) into wanted from jsonb_array_elements(p_payload->'lines') x where nullif(x->>'product_id','')::uuid=p.id;
   if i.status<>'draft' then
     if wanted>0 and not p.active then raise exception 'Product is inactive: %',p.name; end if;
     if p.track_stock then
       select -coalesce(sum(m.delta),0) into deducted from public.stock_movements m where invoice_id=i.id and product_id=p.id;
       delta=deducted-wanted;
       if p.quantity+delta<0 then raise exception 'Insufficient stock: %',p.name; end if;
       if delta<>0 then
         update public.products set quantity=quantity+delta where id=p.id;
         insert into public.stock_movements(shop_id,product_id,invoice_id,delta,reason,created_by)
         values(i.shop_id,p.id,i.id,delta,'Edit '||i.number||' revision '||(i.revision+1),auth.uid());
       end if;
     end if;
   end if;
 end loop;
 -- The full prior item snapshot remains in the append-only audit entry below.
 delete from public.invoice_items where invoice_id=i.id;
 for l in select * from jsonb_array_elements(p_payload->'lines') loop
   insert into public.invoice_items(shop_id,invoice_id,product_id,description,quantity,unit_price)
   values(i.shop_id,i.id,nullif(l->>'product_id','')::uuid,l->>'description',(l->>'quantity')::numeric,(l->>'unit_price')::numeric);
 end loop;
 update public.invoices set customer_id=cust,customer_name=coalesce(c.name,'Walk-in customer'),customer_email=coalesce(c.email,''),billing_address=coalesce(c.billing_address,''),
   issue_date=issue,due_date=due,discount=disc,tax_rate=rate,subtotal=sub,total=ttl,
   notes=coalesce(p_payload->>'notes',i.notes),terms=coalesce(p_payload->>'terms',i.terms),
   terms_customized=case when p_payload->>'terms' is not null then true else i.terms_customized end,
   status=case when i.status='draft' then 'draft' when ttl=paid then 'paid' when due<(now() at time zone 'Asia/Manila')::date then 'overdue' when paid>0 then 'partially paid' else 'pending' end,
   revision=revision+1,updated_at=now() where id=i.id;
 update public.sales set customer_id=cust,total=ttl where invoice_id=i.id;
 delete from public.sale_items where sale_id in (select id from public.sales where invoice_id=i.id);
 insert into public.sale_items(shop_id,sale_id,product_id,description,quantity,unit_price)
 select i.shop_id,s.id,x.product_id,x.description,x.quantity,x.unit_price from public.sales s join public.invoice_items x on x.invoice_id=s.invoice_id where s.invoice_id=i.id;
 select jsonb_build_object('invoice',to_jsonb(v),'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.invoice_items x where invoice_id=i.id)) into new_document from public.invoices v where id=i.id;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details)
 values(i.shop_id,auth.uid(),'Invoice edited',i.id,jsonb_build_object('request_id',req,'before',old_document,'after',new_document));
end $$;
revoke all on function public.edit_invoice(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.edit_invoice(uuid,integer,jsonb) to authenticated;

-- Issuing a draft invalidates any editor opened before that stock-changing transition.
create or replace function public.issue_invoice(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 select shop_id into strict s from public.invoices where id=p_id;
 perform public.require_role(s,array['Administrator','Cashier','Accountant']::public.shop_role[]);
 perform public.post_invoice_internal(p_id,'invoice');
 update public.invoices set revision=revision+1 where id=p_id;
end $$;

-- Edits can fully restore a product before voiding; skip its zero net movement.
create or replace function public.void_invoice(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare i public.invoices; l record;
begin
 select * into strict i from public.invoices where id=p_id for update;
 perform public.require_role(i.shop_id,array['Administrator','Accountant']::public.shop_role[]);
 if i.status='void' or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Provide a reason for a nonvoid invoice'; end if;
 if exists(select 1 from public.payments where invoice_id=i.id) then raise exception 'Paid invoices require an accountant-led refund process before voiding; payment history is preserved'; end if;
 for l in select product_id,-sum(delta) qty from public.stock_movements where invoice_id=i.id group by product_id having sum(delta)<>0 order by product_id loop
   update public.products set quantity=quantity+l.qty where id=l.product_id;
   insert into public.stock_movements(shop_id,product_id,invoice_id,delta,reason,created_by) values(i.shop_id,l.product_id,i.id,l.qty,'Void: '||p_reason,auth.uid());
 end loop;
 update public.invoices set status='void',updated_at=now() where id=i.id;
 update public.sales set status='void' where invoice_id=i.id;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id,details) values(i.shop_id,auth.uid(),'Invoice voided',i.id,jsonb_build_object('reason',p_reason));
end $$;
commit;
