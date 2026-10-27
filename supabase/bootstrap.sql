-- Run once in the trusted Supabase SQL editor AFTER creating your initial Auth user.
-- Replace the UUID and email below. Do not put service credentials in the app.
begin;
do $$
declare
 admin_id uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE with Authentication > Users ID
 admin_email text := 'owner@example.com'; -- REPLACE
 shop uuid;
begin
 if admin_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'Replace the administrator UUID before running bootstrap'; end if;
 if not exists(select 1 from auth.users where id=admin_id and email=admin_email) then raise exception 'Create the matching Auth user first'; end if;
 if exists(select 1 from public.profiles where id=admin_id) then raise exception 'This user already belongs to a shop'; end if;
 insert into public.shops(name) values('My Printing Shop') returning id into shop;
 insert into public.profiles(id,shop_id,display_name,email,role) values(admin_id,shop,'Shop Administrator',admin_email,'Administrator');
 insert into public.shop_settings(shop_id,business_name) values(shop,'My Printing Shop');
 insert into public.invoice_sequences(shop_id) values(shop);
 insert into public.expense_categories(shop_id,name) select shop,unnest(array['Supplies','Utilities','Equipment','Transportation','Other']);
 insert into public.audit_logs(shop_id,actor_id,action,entity_id) values(shop,admin_id,'Shop bootstrapped',shop);
end $$;
commit;
