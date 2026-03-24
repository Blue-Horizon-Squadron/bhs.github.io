/**
 * Durable Object: RegistrationStore
 *
 * Maintains per-operation state:
 * - role capacities (computed from incoming role->slots, persisted on first use)
 * - registrations keyed by (discord)
 *
 * Behaviour:
 * - Upsert: same discord signing up again replaces their previous selection.
 * - Atomic capacity enforcement: cannot exceed role slots.
 */

import { jsonResponse, readJson } from './util.js';
import { getRoleSlotsFromConfig } from './opsConfig.js';

export class RegistrationStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/register' && request.method === 'POST') {
      const body = await readJson(request);
      const res = await this.state.blockConcurrencyWhile(async () => {
        return await this._register(body);
      });
      return res;
    }

    if (url.pathname === '/debug' && request.method === 'GET') {
      const snapshot = await this._snapshot();
      return jsonResponse({ ok: true, snapshot }, 200, '*');
    }

    return new Response('Not found', { status: 404 });
  }

  async _snapshot() {
    const roles = (await this.state.storage.get('roles')) || {};
    const regs = (await this.state.storage.get('regs')) || {};
    return { roles, regsCount: Object.keys(regs).length };
  }

  async _register(body) {
    const discord = String(body.discord).trim();
    const role = String(body.role).trim();
    const roleKey = String(body.role_aircraft || '').trim() || (role + '|');

    // roles structure: { [roleKey]: { slots:number, filled:number } }
    const roles = (await this.state.storage.get('roles')) || {};
    const regs = (await this.state.storage.get('regs')) || {};

    // Trusted role capacity (tamper-proof)
    // Prefer a more specific role key when available to disambiguate duplicate role names.
    let roleSlots = await getRoleSlotsFromConfig(this.env, body.operation_id, roleKey);
    if (!Number.isFinite(roleSlots)) {
      // Last-resort fallback: try plain role name (supports older OPS_CONFIG_JSON formats)
      roleSlots = await getRoleSlotsFromConfig(this.env, body.operation_id, role);
    }

    // Backward compatible fallback (optional): allow client to provide role_slots
    // Only enable this if you explicitly set ALLOW_CLIENT_ROLE_SLOTS=true in env.
    if (!Number.isFinite(roleSlots)) {
      const allowClient = String(this.env.ALLOW_CLIENT_ROLE_SLOTS || '').toLowerCase() === 'true';
      if (allowClient) roleSlots = Number(body.role_slots);
    }

    if (!roles[roleKey]) {
      if (!Number.isFinite(roleSlots) || roleSlots <= 0) {
        return jsonResponse({ ok: false, message: 'Role capacity unknown. This operation is not configured.' }, 400, '*');
      }
      roles[roleKey] = { slots: roleSlots, filled: 0 };
    }

    // Upsert logic: if existing registration exists, free previous role slot
    const previous = regs[discord];
    if (previous && previous.role_key && roles[previous.role_key]) {
      if (roles[previous.role_key].filled > 0) roles[previous.role_key].filled -= 1;
    }

    // Enforce capacity
    if (roles[roleKey].filled >= roles[roleKey].slots) {
      // Revert previous decrement (if any)
      if (previous && previous.role_key && roles[previous.role_key]) {
        roles[previous.role_key].filled += 1;
      }
      await this.state.storage.put('roles', roles);
      await this.state.storage.put('regs', regs);
      return jsonResponse({ ok: false, message: 'That role is full.' }, 409, '*');
    }

    // Reserve slot
    roles[roleKey].filled += 1;

    // Save registration
    regs[discord] = {
      discord,
      callsign: String(body.callsign || '').trim(),
      role,
      role_key: roleKey,
      aircraft: String(body.aircraft || '').trim(),
      experience: String(body.experience || '').trim(),
      notes: String(body.notes || '').trim(),
      notify: Boolean(body.notify),
      updated_at: new Date().toISOString(),
      operation_id: String(body.operation_id || ''),
      operation_name: String(body.operation_name || ''),
    };

    await this.state.storage.put('roles', roles);
    await this.state.storage.put('regs', regs);

    return jsonResponse({ ok: true, result: { role_filled: roles[roleKey].filled, role_slots: roles[roleKey].slots } }, 200, '*');
  }
}
