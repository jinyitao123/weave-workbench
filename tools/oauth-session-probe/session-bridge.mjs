import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Isolated proof only. This plugin is deliberately absent from the product stack.
// nativeEmployee is the unchanged Forge employee/session/organization validator.
export function desktopOidcProbe({ nativeEmployee, loadClient, audit = () => {} }) {
  const flows = new Map();
  const route = '/api/v1/apps/forge/desktop-oidc-probe';
  const fail = (status, code) => Object.assign(new Error(code), { status, code });
  const text = (value, max = 2048) => typeof value === 'string' && value.length > 0 && value.length <= max;
  return {
    name: 'local.probe.desktop-oidc',
    init(context) {
      context.hook('kernel:ready', () => {
        const server = context.getService('http.server');
        const auth = context.getService('auth');
        const run = (handler) => async (request, response) => {
          response.header('Cache-Control', 'no-store');
          response.header('Pragma', 'no-cache');
          try { return response.status(200).json(await handler(request.body ?? {})); }
          catch (error) {
            const status = [400, 401, 403, 429, 503].includes(error?.status) ? error.status : 503;
            audit({ event: 'exchange-refused', status, reason: /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'UNCLASSIFIED', at: new Date().toISOString() });
            return response.status(status).json({ error: { code: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 403 ? 'FORBIDDEN' : status === 400 ? 'INVALID_REQUEST' : status === 429 ? 'RATE_LIMIT_EXCEEDED' : 'UNAUTHENTICATED', message: '本地登录验证未完成' } });
          }
        };
        server.post(`${route}/start`, run(async (body) => {
          if (Object.keys(body).some(key => key !== 'codeChallenge') || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge ?? '')) throw fail(400, 'INVALID_REQUEST');
          const config = loadClient();
          if (!config?.clientId || !config?.redirectUri) throw fail(503, 'SERVICE_UNAVAILABLE');
          for (const [id, flow] of flows) if (flow.deadline <= Date.now()) flows.delete(id);
          if (flows.size >= 128) throw fail(429, 'RATE_LIMIT_EXCEEDED');
          const flowId = randomUUID(), state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url');
          const issuer = auth.getAuthIssuer();
          const flow = { ...config, issuer, state, nonce, challenge: body.codeChallenge, deadline: Date.now() + 180_000 };
          flows.set(flowId, flow);
          const url = new URL(`${issuer}/oauth2/authorize`);
          url.search = new URLSearchParams({ client_id: flow.clientId, redirect_uri: flow.redirectUri,
            response_type: 'code', scope: 'openid profile email', state, nonce,
            code_challenge: flow.challenge, code_challenge_method: 'S256' }).toString();
          audit({ event: 'started', flowId, at: new Date().toISOString() });
          return { flowId, state, authorizationUrl: url.href };
        }));
        server.post(`${route}/cancel`, run(async ({ flowId }) => {
          if (!text(flowId, 64)) throw fail(400, 'INVALID_REQUEST');
          flows.delete(flowId);
          audit({ event: 'cancelled', flowId, at: new Date().toISOString() });
          return { cancelled: true };
        }));
        server.post(`${route}/exchange`, run(async (body) => {
          const { flowId, code, codeVerifier } = body;
          if (Object.keys(body).some(key => !['flowId', 'code', 'codeVerifier'].includes(key)) || !text(flowId, 64) || !text(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier ?? '')) throw fail(400, 'INVALID_REQUEST');
          const flow = flows.get(flowId);
          if (!flow || flow.deadline <= Date.now()) { flows.delete(flowId); throw fail(401, 'UNAUTHENTICATED'); }
          if (createHash('sha256').update(codeVerifier).digest('base64url') !== flow.challenge) throw fail(401, 'UNAUTHENTICATED');
          // Consume before any await: concurrent attempts cannot create two sessions.
          flows.delete(flowId);
          const tokenResponse = await fetch(`${flow.issuer}/oauth2/token`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: flow.clientId,
              redirect_uri: flow.redirectUri, code, code_verifier: codeVerifier }),
          });
          if (!tokenResponse.ok) { await tokenResponse.body?.cancel(); throw fail(tokenResponse.status >= 500 ? 503 : 401, 'UNAUTHENTICATED'); }
          const tokens = await tokenResponse.json();
          const { createLocalJWKSet, jwtVerify } = await import('jose');
          const api = await auth.getApi();
          let payload;
          try { ({ payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(await api.getJwks()), { issuer: flow.issuer, audience: flow.clientId })); }
          catch { throw fail(401, 'ID_TOKEN_INVALID'); }
          if (payload.nonce !== flow.nonce) throw fail(401, 'NONCE_MISMATCH');
          if (!text(payload.sub, 128) || !text(payload.sid, 128)) throw fail(401, 'SOURCE_SESSION_CLAIM_MISSING');
          const authContext = await auth.getAuthContext();
          const source = await authContext.adapter.findOne({ model: 'session', where: [{ field: 'id', value: payload.sid }] });
          if (!source || source.userId !== payload.sub || !text(source.token)) throw fail(401, 'SOURCE_SESSION_UNAVAILABLE');
          const sourceRequest = { headers: { authorization: `Bearer ${source.token}` } };
          const employee = await nativeEmployee(context, sourceRequest);
          if (employee.userId !== payload.sub || employee.sessionId !== payload.sid) throw fail(401, 'UNAUTHENTICATED');
          let issued;
          try {
            // Native creation hooks still apply; never insert sys_session with SQL.
            issued = await authContext.internalAdapter.createSession(employee.userId, true, {
              activeOrganizationId: employee.organizationId,
              expiresAt: new Date(Math.min(employee.expiresAt, Date.now() + 8 * 60 * 60_000)),
            }, true);
            if (!issued?.token || issued.token === source.token) throw fail(503, 'SERVICE_UNAVAILABLE');
            const current = await nativeEmployee(context, sourceRequest);
            const verified = await nativeEmployee(context, { headers: { authorization: `Bearer ${issued.token}` } });
            if (current.organizationId !== employee.organizationId || verified.userId !== employee.userId || verified.organizationId !== employee.organizationId) throw fail(401, 'UNAUTHENTICATED');
            audit({ event: 'issued', flowId, userId: verified.userId, organizationId: verified.organizationId,
              sourceSessionId: employee.sessionId, sessionId: verified.sessionId, at: new Date().toISOString() });
            return { token: issued.token, userId: verified.userId, organizationId: verified.organizationId, expiresAt: new Date(verified.expiresAt).toISOString() };
          } catch (error) {
            if (issued?.token) await authContext.internalAdapter.deleteSession(issued.token);
            throw error;
          }
        }));
      });
    },
  };
}
