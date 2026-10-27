import { createClient } from 'npm:@supabase/supabase-js@2';
import { staffHandler } from './handler.ts';
const server = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const handler = staffHandler(
  {
    async actor(token) {
      const { data, error } = await server.auth.getUser(token);
      if (error || !data.user) return null;
      const p = await server
        .from('profiles')
        .select('id,shop_id,role,active')
        .eq('id', data.user.id)
        .single();
      if (p.error) return null;
      return p.data;
    },
    async member(id) {
      const { data, error } = await server
        .from('profiles')
        .select('id,shop_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async create(email, password, name) {
      const { data, error } = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: name },
      });
      if (error || !data.user) throw new Error('Account creation failed');
      return data.user.id;
    },
    async provision(id, actor, name, email, role) {
      const { error } = await server.rpc('provision_staff_member', {
        p_id: id,
        p_shop: actor.shop_id,
        p_name: name,
        p_email: email,
        p_role: role,
        p_actor: actor.id,
      });
      if (error) throw error;
    },
    async rollbackCreated(id) {
      const profile = await server.from('profiles').select('id').eq('id', id).maybeSingle();
      if (profile.error || profile.data) return false;
      const { error } = await server.auth.admin.deleteUser(id);
      return !error;
    },
    async setPassword(id, password) {
      const { error } = await server.auth.admin.updateUserById(id, { password });
      if (error) throw error;
    },
    async auditPassword(id, actor, stage) {
      const { error } = await server.rpc('audit_staff_password_change', {
        p_id: id,
        p_actor: actor,
        p_stage: stage,
      });
      if (error) throw error;
    },
  },
  Deno.env.get('APP_URL')!,
);
Deno.serve(handler);
