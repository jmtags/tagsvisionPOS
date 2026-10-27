export interface Actor {
  id: string;
  shop_id: string;
  role: string;
  active: boolean;
}
export interface StaffServices {
  actor(token: string): Promise<Actor | null>;
  member(id: string): Promise<{ id: string; shop_id: string } | null>;
  create(email: string, password: string, name: string): Promise<string>;
  provision(id: string, actor: Actor, name: string, email: string, role: string): Promise<void>;
  rollbackCreated(id: string): Promise<boolean>;
  setPassword(id: string, password: string): Promise<void>;
  auditPassword(
    id: string,
    actor: string,
    stage: 'requested' | 'completed' | 'failed',
  ): Promise<void>;
}
const roles = ['Administrator', 'Cashier', 'Staff', 'Accountant'];
export function staffHandler(services: StaffServices, appUrl: string) {
  return async (req: Request): Promise<Response> => {
    const allowed = new URL(appUrl).origin;
    const headers = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    const reply = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), { status, headers });
    const origin = req.headers.get('origin');
    if (origin && origin !== allowed) return reply(403, { error: 'Origin not allowed' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'POST required' });
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Authentication required' });
    try {
      const actor = await services.actor(token);
      if (!actor) return reply(401, { error: 'Invalid session' });
      if (!actor.active || actor.role !== 'Administrator')
        return reply(403, { error: 'Administrator access required' });
      let body: Record<string, unknown>;
      try {
        body = await req.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      } catch {
        return reply(400, { error: 'Invalid request' });
      }
      if (!['create', 'password'].includes(String(body.action)))
        return reply(400, { error: 'Unknown action' });
      const password = body.password;
      if (
        typeof password !== 'string' ||
        password.length < 12 ||
        new TextEncoder().encode(password).length > 72
      )
        return reply(400, {
          error: 'Use a password of at least 12 characters and at most 72 UTF-8 bytes.',
        });
      if (body.action === 'create') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
        const role = typeof body.role === 'string' ? body.role : '';
        if (
          !name ||
          name.length > 120 ||
          email.length > 254 ||
          !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !roles.includes(role)
        )
          return reply(400, { error: 'Valid name, email, and role are required' });
        // createUser rejects existing accounts. Never attach or overwrite an existing identity.
        const id = await services.create(email, password, name);
        try {
          await services.provision(id, actor, name, email, role);
        } catch {
          const rolledBack = await services.rollbackCreated(id).catch(() => false);
          return reply(409, {
            error: rolledBack
              ? 'Account setup failed; the newly created login was rolled back. Try again.'
              : 'Account setup could not be confirmed. An administrator must reconcile this Auth user and profile before retrying.',
          });
        }
        return reply(200, {
          id,
          message: 'Staff account created. No confirmation email is required.',
        });
      }
      if (
        typeof body.user_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.user_id)
      )
        return reply(400, { error: 'Valid user ID required' });
      const member = await services.member(body.user_id);
      if (!member || member.shop_id !== actor.shop_id)
        return reply(403, { error: 'User is not a member of your shop' });
      await services.auditPassword(member.id, actor.id, 'requested');
      try {
        await services.setPassword(member.id, password);
      } catch {
        await services.auditPassword(member.id, actor.id, 'failed').catch(() => {});
        return reply(400, {
          error:
            'Password could not be changed. Check your Supabase password policy and try again.',
        });
      }
      try {
        await services.auditPassword(member.id, actor.id, 'completed');
      } catch {
        return reply(200, {
          message: 'Password changed.',
          warning:
            'The completion audit could not be confirmed; the request audit was recorded. Administrator review is required.',
        });
      }
      return reply(200, {
        message: 'Password changed. Share the new password with the staff member securely.',
      });
    } catch {
      // Never echo Auth errors that could contain submitted passwords or other request data.
      return reply(400, {
        error:
          'Staff operation failed. Check that the email is unused, the password meets your Auth policy, and the staff migration is applied.',
      });
    }
  };
}
