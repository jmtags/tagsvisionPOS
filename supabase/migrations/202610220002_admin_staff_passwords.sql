-- Apply after the initial migration. Passwords stay in Supabase Auth only.
create function public.provision_staff_member(
  p_id uuid, p_shop uuid, p_name text, p_email text,
  p_role public.shop_role, p_actor uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.shops where id=p_shop for update;
  if not exists (
    select 1 from public.profiles
    where id=p_actor and shop_id=p_shop and role='Administrator' and active
  ) then raise exception 'Administrator required' using errcode='42501'; end if;
  if length(trim(p_name)) not between 1 and 120 or length(p_email)>254 then
    raise exception 'Invalid staff details';
  end if;
  insert into public.profiles(id,shop_id,display_name,email,role)
  values(p_id,p_shop,p_name,p_email,p_role);
  insert into public.audit_logs(shop_id,actor_id,action,entity_id,details)
  values(p_shop,p_actor,'Staff account created',p_id,jsonb_build_object('role',p_role));
end $$;

create function public.audit_staff_password_change(p_id uuid,p_actor uuid,p_stage text)
returns void language plpgsql security definer set search_path='' as $$
declare target_shop uuid;
begin
  select shop_id into strict target_shop from public.profiles where id=p_id;
  if not exists (
    select 1 from public.profiles
    where id=p_actor and shop_id=target_shop and role='Administrator' and active
  ) then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_stage not in ('requested','completed','failed') or p_stage is null then
    raise exception 'Invalid audit stage';
  end if;
  insert into public.audit_logs(shop_id,actor_id,action,entity_id)
  values(target_shop,p_actor,'Staff password change '||p_stage,p_id);
end $$;

revoke all on function public.provision_staff_member(uuid,uuid,text,text,public.shop_role,uuid)
from public,anon,authenticated;
revoke all on function public.audit_staff_password_change(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.provision_staff_member(uuid,uuid,text,text,public.shop_role,uuid),
 public.audit_staff_password_change(uuid,uuid,text) to service_role;
