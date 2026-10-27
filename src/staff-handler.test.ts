import { describe, expect, it, vi } from 'vitest';
import { staffHandler } from '../supabase/functions/manage-staff/handler';
import type { Actor, StaffServices } from '../supabase/functions/manage-staff/handler';
const actor: Actor = { id: 'admin', shop_id: 'shop', role: 'Administrator', active: true };
const target = '30000000-0000-0000-0000-000000000001';
const password = 'Long-Staff-Password-2026';
function setup(change: Partial<StaffServices> = {}) {
  const services = {
    actor: vi.fn().mockResolvedValue(actor),
    member: vi.fn().mockResolvedValue({ id: target, shop_id: 'shop' }),
    create: vi.fn().mockResolvedValue(target),
    provision: vi.fn().mockResolvedValue(undefined),
    rollbackCreated: vi.fn().mockResolvedValue(true),
    setPassword: vi.fn().mockResolvedValue(undefined),
    auditPassword: vi.fn().mockResolvedValue(undefined),
    ...change,
  };
  return { services, handler: staffHandler(services, 'http://localhost:5173') };
}
const request = (body: unknown, token = 'valid', origin = 'http://localhost:5173') =>
  new Request('http://edge.test/manage-staff', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
const createBody = {
  action: 'create',
  email: 'staff@example.test',
  display_name: 'Staff Name',
  role: 'Cashier',
  password,
};
describe('trusted staff password endpoint', () => {
  it('creates accounts through the trusted adapter without returning the password', async () => {
    const { handler, services } = setup();
    const res = await handler(request(createBody));
    expect(res.status).toBe(200);
    expect(services.create).toHaveBeenCalledWith(
      createBody.email,
      password,
      createBody.display_name,
    );
    expect(services.provision).toHaveBeenCalledWith(
      target,
      actor,
      createBody.display_name,
      createBody.email,
      'Cashier',
    );
    expect(await res.text()).not.toContain(password);
  });
  it.each(['Cashier', 'Staff', 'Accountant'])(
    'rejects %s before creating or resetting any password',
    async (role) => {
      const { handler, services } = setup({ actor: vi.fn().mockResolvedValue({ ...actor, role }) });
      expect((await handler(request(createBody))).status).toBe(403);
      expect(
        (await handler(request({ action: 'password', user_id: target, password }))).status,
      ).toBe(403);
      expect(services.create).not.toHaveBeenCalled();
      expect(services.setPassword).not.toHaveBeenCalled();
    },
  );
  it('rejects missing/invalid sessions and deactivated administrators', async () => {
    const { handler, services } = setup();
    expect((await handler(request(createBody, ''))).status).toBe(401);
    expect(services.actor).not.toHaveBeenCalled();
    const inactive = setup({ actor: vi.fn().mockResolvedValue({ ...actor, active: false }) });
    expect((await inactive.handler(request(createBody))).status).toBe(403);
    const invalid = setup({ actor: vi.fn().mockResolvedValue(null) });
    expect((await invalid.handler(request(createBody))).status).toBe(401);
  });
  it('rejects cross-shop password resets before calling Auth', async () => {
    const { handler, services } = setup({
      member: vi.fn().mockResolvedValue({ id: target, shop_id: 'other' }),
    });
    expect((await handler(request({ action: 'password', user_id: target, password }))).status).toBe(
      403,
    );
    expect(services.setPassword).not.toHaveBeenCalled();
  });
  it('records reset intent and completion without password data', async () => {
    const { handler, services } = setup();
    expect((await handler(request({ action: 'password', user_id: target, password }))).status).toBe(
      200,
    );
    expect(services.auditPassword).toHaveBeenNthCalledWith(1, target, actor.id, 'requested');
    expect(services.setPassword).toHaveBeenCalledWith(target, password);
    expect(services.auditPassword).toHaveBeenNthCalledWith(2, target, actor.id, 'completed');
  });
  it.each(['short', 'a'.repeat(73), null, 123])(
    'rejects an invalid password before changing Auth',
    async (value) => {
      const { handler, services } = setup();
      expect((await handler(request({ ...createBody, password: value }))).status).toBe(400);
      expect(services.create).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid email, unknown role and untrusted origins', async () => {
    const { handler, services } = setup();
    expect((await handler(request({ ...createBody, email: 'bad' }))).status).toBe(400);
    expect((await handler(request({ ...createBody, role: 'Owner' }))).status).toBe(400);
    expect((await handler(request(createBody, 'valid', 'https://other.test'))).status).toBe(403);
    expect(services.create).not.toHaveBeenCalled();
  });
  it('rolls back only the new identity when provisioning fails', async () => {
    const { handler, services } = setup({
      provision: vi.fn().mockRejectedValue(new Error('Failure')),
    });
    expect((await handler(request(createBody))).status).toBe(409);
    expect(services.rollbackCreated).toHaveBeenCalledWith(target);
  });
  it('does not provision or delete an existing identity after duplicate account errors', async () => {
    const { handler, services } = setup({
      create: vi.fn().mockRejectedValue(new Error('Already exists')),
    });
    expect((await handler(request(createBody))).status).toBe(400);
    expect(services.provision).not.toHaveBeenCalled();
    expect(services.rollbackCreated).not.toHaveBeenCalled();
  });
  it('reports an audit completion failure as a changed password, without encouraging a silent retry', async () => {
    const { handler } = setup({
      auditPassword: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Network')),
    });
    const res = await handler(request({ action: 'password', user_id: target, password }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('warning');
  });
});
