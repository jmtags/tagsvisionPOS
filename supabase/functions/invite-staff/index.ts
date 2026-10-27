import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appUrl = Deno.env.get('APP_URL')!;
const roles = ['Administrator', 'Cashier', 'Staff', 'Accountant'];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const allowedOrigin = appUrl ? new URL(appUrl).origin : '';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!allowedOrigin || (origin && origin !== allowedOrigin))
    return respond(403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return respond(405, { error: 'POST required' });
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return respond(401, { error: 'Authentication required' });
  const server = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await server.auth.getUser(token);
  if (authError || !auth.user) return respond(401, { error: 'Invalid session' });
  const { data: actor, error: profileError } = await server
    .from('profiles')
    .select('shop_id,role,active')
    .eq('id', auth.user.id)
    .single();
  if (profileError || !actor?.active || actor.role !== 'Administrator')
    return respond(403, { error: 'Administrator access required' });
  let body: { email?: string; display_name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }
  const email = body.email?.trim().toLowerCase();
  const name = body.display_name?.trim();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !name ||
    name.length > 120 ||
    !roles.includes(body.role || '')
  )
    return respond(400, { error: 'Valid name, email, and role are required' });
  const { data: invitation, error: inviteError } = await server.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: appUrl, data: { display_name: name } },
  );
  if (inviteError || !invitation.user)
    return respond(400, { error: inviteError?.message || 'Invitation failed' });
  const { error: provisionError } = await server.rpc('provision_invited_member', {
    p_id: invitation.user.id,
    p_shop: actor.shop_id,
    p_name: name,
    p_email: email,
    p_role: body.role,
    p_actor: auth.user.id,
  });
  if (provisionError)
    return respond(409, {
      error:
        'Auth invitation was created, but shop membership could not be provisioned. An administrator must reconcile this account in the Supabase dashboard before it can access shop data.',
    });
  return respond(200, { id: invitation.user.id, message: 'Auth invitation created' });
});
