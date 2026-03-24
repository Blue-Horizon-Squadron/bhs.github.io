/**
 * BHS Registration Worker
 *
 * POST /register
 * - Validates payload
 * - Enforces role capacity atomically (Durable Object)
 * - Upserts registration by (operation_id + discord)
 * - Optionally posts to Discord webhook
 * - Optionally appends to Google Sheets
 */

import { RegistrationStore } from './store.js';
import { jsonResponse, readJson, requireAuth, corsHeaders, isAllowedOrigin, issueAdminCookie } from './util.js';
import { postDiscord } from './discord.js';
import { upsertRegistrationRow } from './googleSheets.js';

async function getOpsConfigStatus(env) {
  const status = {
    hasKvBinding: Boolean(env.OPS_CONFIG),
    hasOpsConfigJsonKey: null,
    opsConfigJsonBytes: null,
    opsConfigOpIds: null,
    error: null,
  };

  if (!env.OPS_CONFIG) return status;

  try {
    const raw = await env.OPS_CONFIG.get('OPS_CONFIG_JSON');
    status.hasOpsConfigJsonKey = Boolean(raw);
    status.opsConfigJsonBytes = raw ? raw.length : 0;
    if (raw) {
      const parsed = JSON.parse(raw);
      status.opsConfigOpIds = Object.keys(parsed);
    }
  } catch (e) {
    status.error = e?.message || String(e);
  }

  return status;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Basic CORS
    const origin = request.headers.get('Origin');
    const originAllowed = isAllowedOrigin(origin, env);
    const allowOrigin = originAllowed ? origin : '*';

    // If an allowlist is configured, block disallowed cross-origin requests.
    // (Still allows requests with no Origin header, e.g. server-to-server/tests.)
    const hasOrigin = Boolean(origin);
    const hasAllowlist = Boolean((env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).length);
    if (hasOrigin && hasAllowlist && !originAllowed) {
      return jsonResponse({ ok: false, message: 'Origin not allowed.' }, 403, allowOrigin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    // Admin: login (sets HttpOnly cookie). Protected by providing the shared secret once.
    // POST /admin/login { secret: "..." }
    if (url.pathname === '/admin/login' && request.method === 'POST') {
      try {
        const body = await readJson(request);
        const want = env.BHS_SHARED_SECRET;
        if (!want) {
          return jsonResponse({ ok: false, message: 'Admin auth not configured.' }, 400, allowOrigin);
        }
        const got = String(body.secret || '');
        if (!got || got !== want) {
          return jsonResponse({ ok: false, message: 'Unauthorized' }, 401, allowOrigin);
        }

        const cookie = await issueAdminCookie(env);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            ...corsHeaders(allowOrigin),
            'Set-Cookie': cookie,
          },
        });
      } catch (e) {
        return jsonResponse({ ok: false, message: e?.message || 'Unauthorized' }, 401, allowOrigin);
      }
    }

    // Admin: logout (clears cookie)
    // POST /admin/logout
    if (url.pathname === '/admin/logout' && request.method === 'POST') {
      const isProd = String(env.COOKIE_SECURE || '').toLowerCase() === 'true';
      const secure = isProd ? ' Secure;' : '';
      const clear = `bhs_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...corsHeaders(allowOrigin),
          'Set-Cookie': clear,
        },
      });
    }

    // Lightweight health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true }, 200, allowOrigin);
    }

    // Public: live role status for an operation
    // GET /ops-status?operation_id=op-002
    if (url.pathname === '/ops-status' && request.method === 'GET') {
      try {
        const operationId = url.searchParams.get('operation_id');
        if (!operationId || operationId.trim() === '') {
          return jsonResponse({ ok: false, message: 'Missing operation_id.' }, 400, allowOrigin);
        }

        const roleKeysParam = url.searchParams.get('role_keys');
        const roleKeysQs = roleKeysParam ? `&role_keys=${encodeURIComponent(String(roleKeysParam))}` : '';

        const id = env.REG_STORE.idFromName(String(operationId));
        const stub = env.REG_STORE.get(id);

        const res = await stub.fetch(`https://do/status?operation_id=${encodeURIComponent(String(operationId))}${roleKeysQs}`, {
          method: 'GET',
          env: { OPS_CONFIG: env.OPS_CONFIG },
        });

        const j = await res.json().catch(() => ({ ok: false, message: 'Status error.' }));
        return jsonResponse(j, res.status || 200, allowOrigin);
      } catch (e) {
        return jsonResponse({ ok: false, message: e?.message || 'Server error.' }, 500, allowOrigin);
      }
    }

    // Admin: reset operation state (protected)
    // POST /admin/reset  { operation_id: "op-001" }
    // POST /admin/reset  { all: true }    (dangerous)
    if (url.pathname === '/admin/reset' && request.method === 'POST') {
      try {
        requireAuth(request, env);
        const body = await readJson(request);

        const resetAll = Boolean(body.all);
        const operationId = body.operation_id ? String(body.operation_id) : null;
        if (!resetAll && (!operationId || operationId.trim() === '')) {
          return jsonResponse({ ok: false, message: 'Missing operation_id (or set all=true).' }, 400, allowOrigin);
        }

        // Basic guard rails
        if (resetAll && String(env.ALLOW_ADMIN_RESET_ALL || '').toLowerCase() !== 'true') {
          return jsonResponse({ ok: false, message: 'Reset-all disabled.' }, 403, allowOrigin);
        }

        let cleared = 0;

        if (resetAll) {
          // NOTE: there is no list() for Durable Objects; we can only reset known IDs.
          // This path is kept for completeness but requires you to supply op ids elsewhere.
          return jsonResponse({ ok: false, message: 'Reset-all is not supported without an operation id list.' }, 400, allowOrigin);
        }

        const id = env.REG_STORE.idFromName(String(operationId));
        const stub = env.REG_STORE.get(id);
        const res = await stub.fetch('https://do/admin/reset', {
          method: 'POST',
          // Forward bindings DO may need (not strictly required for reset)
          env: { OPS_CONFIG: env.OPS_CONFIG },
        });

        if (!res.ok) {
          const j = await res.json().catch(() => null);
          return jsonResponse({ ok: false, message: j?.message || 'Reset failed.' }, res.status, allowOrigin);
        }

        cleared = 1;
        return jsonResponse({ ok: true, cleared, operation_id: String(operationId) }, 200, allowOrigin);
      } catch (e) {
        return jsonResponse({ ok: false, message: e?.message || 'Unauthorized' }, 401, allowOrigin);
      }
    }

    // Admin: config status (protected)
    if (url.pathname === '/admin/config-status' && request.method === 'GET') {
      try {
        requireAuth(request, env);

        console.log('[config-status] version check', {
          hasOpsConfig: Boolean(env.OPS_CONFIG),
          hasRegStore: Boolean(env.REG_STORE),
        });

        let raw = null;
        let parsed = null;
        let err = null;
        try {
          raw = env.OPS_CONFIG ? await env.OPS_CONFIG.get('OPS_CONFIG_JSON') : null;
          parsed = raw ? JSON.parse(raw) : null;
        } catch (e) {
          err = e?.message || String(e);
          console.log('[config-status] ops config read error', err);
        }

        return jsonResponse(
          {
            ok: true,
            opsConfig: {
              hasKvBinding: Boolean(env.OPS_CONFIG),
              hasOpsConfigJsonKey: raw != null,
              opsConfigJsonBytes: raw ? raw.length : null,
              opsConfigOpIds: parsed ? Object.keys(parsed) : null,
              error: err,
            },
            envChecks: {
              hasDiscordWebhook: Boolean(env.DISCORD_WEBHOOK_URL),
              hasGSheetId: Boolean(env.GSHEET_ID),
              hasGSheetTab: Boolean(env.GSHEET_TAB),
              hasGoogleServiceAccountJson: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
            },
          },
          200,
          allowOrigin
        );
      } catch (e) {
        return jsonResponse({ ok: false, message: e?.message || 'Unauthorized' }, 401, allowOrigin);
      }
    }

    if (url.pathname === '/register' && request.method === 'POST') {
      try {
        // NOTE: /register is intentionally public so the static site can submit.
        // Admin endpoints remain protected by X-BHS-Auth.

        const body = await readJson(request);

        const required = ['operation_id', 'operation_name', 'discord', 'callsign', 'role', 'aircraft'];
        for (const k of required) {
          if (!body[k] || String(body[k]).trim() === '') {
            return jsonResponse({ ok: false, message: `Missing field: ${k}` }, 400, allowOrigin);
          }
        }

        // Rate-limit / spam mitigation (lightweight)
        if (String(body.discord).length > 64 || String(body.callsign).length > 64) {
          return jsonResponse({ ok: false, message: 'Input too long.' }, 400, allowOrigin);
        }

        // Durable Object per operation
        const opId = String(body.operation_id);
        const id = env.REG_STORE.idFromName(opId);
        const stub = env.REG_STORE.get(id);

        const storeRes = await stub.fetch('https://do/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          // Forward bindings the DO needs (KV for trusted capacities)
          env: {
            OPS_CONFIG: env.OPS_CONFIG,
            ALLOW_CLIENT_ROLE_SLOTS: env.ALLOW_CLIENT_ROLE_SLOTS,
          },
        });

        const storeJson = await storeRes.json().catch(() => ({ ok: false, message: 'Store error' }));
        if (!storeRes.ok || !storeJson.ok) {
          return jsonResponse({ ok: false, message: storeJson.message || 'Registration failed.' }, storeRes.status || 400, allowOrigin);
        }

        // Side effects
        const payloadForNotify = { ...body, ...storeJson.result };

        // Discord: only notify on create by default. Optionally notify on updates that change role.
        const notifyOnUpdate = String(env.DISCORD_NOTIFY_ON_UPDATE || '').toLowerCase() === 'true';
        const notifyOnRoleChange = String(env.DISCORD_NOTIFY_ON_ROLE_CHANGE || '').toLowerCase() === 'true';
        const created = Boolean(storeJson.result?.created);
        const updated = Boolean(storeJson.result?.updated);
        const roleChanged = Boolean(storeJson.result?.role_changed);
        const shouldNotify = created || (updated && (notifyOnUpdate || (notifyOnRoleChange && roleChanged)));

        if (env.DISCORD_WEBHOOK_URL && shouldNotify) {
          ctx.waitUntil(postDiscord(env.DISCORD_WEBHOOK_URL, payloadForNotify));
        }

        if (env.GSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
          ctx.waitUntil(upsertRegistrationRow(env, payloadForNotify));
        }

        return jsonResponse({ ok: true }, 200, allowOrigin);
      } catch (e) {
        return jsonResponse({ ok: false, message: e?.message || 'Server error.' }, 500, allowOrigin);
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(allowOrigin) });
  }
};

export { RegistrationStore };
