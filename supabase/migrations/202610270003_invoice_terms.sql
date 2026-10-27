-- Preserve copied or edited invoice terms without changing the shop defaults.
-- All existing authorization, idempotency, numbering and stock checks are retained.
begin;

-- Distinguish intentionally cleared terms from older invoices without configured terms.
alter table public.invoices add column terms_customized boolean not null default false;

create or replace function public.create_document(p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines')<>'array' then raise exception 'Provide 1-200 line items'; end if;
 if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'Provide 1-200 line items'; end if;
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
 insert into public.invoices(shop_id,request_id,number,customer_id,customer_name,customer_email,billing_address,business_details,issue_date,due_date,discount,tax_rate,tax_label,subtotal,total,status,notes,terms,terms_customized,created_by)
 values(s,req,cfg.invoice_prefix||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0'),cust,coalesce(c.name,'Walk-in customer'),coalesce(c.email,''),coalesce(c.billing_address,''),to_jsonb(cfg),issue,due,disc,rate,cfg.tax_label,sub,ttl,'draft',coalesce(p_payload->>'notes',''),coalesce(p_payload->>'terms',cfg.terms),p_payload->>'terms' is not null,auth.uid()) returning id into iid;
 for l in select * from jsonb_array_elements(p_payload->'lines') loop
 insert into public.invoice_items(shop_id,invoice_id,product_id,description,quantity,unit_price) values(s,iid,nullif(l->>'product_id','')::uuid,l->>'description',(l->>'quantity')::numeric,(l->>'unit_price')::numeric);
 end loop;
 if not isdraft then perform public.post_invoice_internal(iid,method); end if;
 insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(s,auth.uid(),'Invoice created',iid);
 return iid;
end $$;

commit;
