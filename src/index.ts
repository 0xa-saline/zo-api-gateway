import { forwardNonStreaming, buildStreamingResponse, forwardOpenAINonStreaming, buildOpenAIStreamingResponse } from './converter';
import { getAdminHTML } from './admin';
import { pickToken, markFailed, markSuccess, getPoolStatus } from './key-pool';
import { getTokens, addToken, removeToken, toggleToken, updateToken, getEnabledTokenStrings, updateTokenStatus, updateTokenQuota, autoDisableToken } from './token-store';
import { getLogs, addLog } from './call-log';
import { checkTokenValidity, checkTokenQuota } from './key-checker';
import { FAVICON_BASE64 } from './favicon';
import type { AnthropicRequest, OpenAIChatRequest } from './types';
import type { KeyPoolConfig } from './key-pool';

interface Env {
  KV: KVNamespace;
  GATEWAY_KEY?: string;
  ZO_TOKENS?: string;
  COOLDOWN_MS?: string;
}

const ZO_MODELS = [
  { id: 'zo:anthropic/claude-opus-4-7', owned_by: 'Anthropic' },
  { id: 'zo:anthropic/claude-sonnet-4-6', owned_by: 'Anthropic' },
  { id: 'zo:openai/gpt-5.3-codex', owned_by: 'OpenAI' },
  { id: 'zo:openai/gpt-5.4', owned_by: 'OpenAI' },
  { id: 'zo:openai/gpt-5.5', owned_by: 'OpenAI' },
  { id: 'zo:openai/gpt-5.4-mini', owned_by: 'OpenAI' },
  { id: 'zo:deepseek/deepseek-v4-pro', owned_by: 'DeepSeek' },
  { id: 'zo:zai/glm-5', owned_by: 'Z.AI' },
  { id: 'zo:minimax/minimax-m2.5', owned_by: 'Minimax' },
  { id: 'zo:minimax/minimax-m2.7', owned_by: 'Minimax' },
  { id: 'zo:google/gemini-3.1-pro-preview', owned_by: 'Google' },
];

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key, anthropic-version',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'content-type',
  };
}

function extractClientKey(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) return apiKey;
  return null;
}

function errorResponse(status: number, type: string, message: string): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type, message } }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } },
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function parseEnvTokens(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

async function buildPoolConfig(env: Env): Promise<KeyPoolConfig | null> {
  const cooldownMs = parseInt(env.COOLDOWN_MS || '60000', 10);

  if (env.KV) {
    const kvTokens = await getEnabledTokenStrings(env.KV);
    if (kvTokens.length > 0) {
      return { tokens: kvTokens, cooldownMs };
    }
  }

  if (env.ZO_TOKENS) {
    const envTokens = parseEnvTokens(env.ZO_TOKENS);
    if (envTokens.length > 0) {
      return { tokens: envTokens, cooldownMs };
    }
  }

  return null;
}

function isGatewayMode(env: Env): boolean {
  return !!env.GATEWAY_KEY;
}

function verifyAdmin(request: Request, env: Env): boolean {
  if (!env.GATEWAY_KEY) return false;
  const key = extractClientKey(request);
  return key === env.GATEWAY_KEY;
}

function resolveToken(clientKey: string, env: Env, poolConfig: KeyPoolConfig | null): string | null {
  const gatewayMode = isGatewayMode(env);
  if (gatewayMode && poolConfig) {
    if (clientKey !== env.GATEWAY_KEY) return null;
    return pickToken(poolConfig);
  }
  return clientKey;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Favicon
    if (url.pathname === '/favicon.ico' && request.method === 'GET') {
      const buf = Uint8Array.from(atob(FAVICON_BASE64), (c) => c.charCodeAt(0));
      return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800', ...corsHeaders() } });
    }

    // Admin panel
    if ((url.pathname === '/' || url.pathname === '/admin') && request.method === 'GET') {
      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(getAdminHTML(baseUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }

    // Models list (OpenAI compatible)
    if (url.pathname === '/v1/models' && request.method === 'GET') {
      const now = Math.floor(Date.now() / 1000);
      const data = ZO_MODELS.map((m) => ({
        id: m.id,
        object: 'model',
        created: now,
        owned_by: m.owned_by,
      }));
      return jsonResponse({ object: 'list', data });
    }

    // Admin API - tokens
    if (url.pathname === '/admin/tokens') {
      if (!verifyAdmin(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (request.method === 'GET') {
        const tokens = await getTokens(env.KV);
        const poolConfig = await buildPoolConfig(env);
        const poolStatus = poolConfig ? getPoolStatus(poolConfig) : { total: 0, available: 0 };
        const safeTokens = tokens.map((t) => ({
          token: t.token,
          email: t.email || '',
          spaceName: t.spaceName || '',
          addedAt: t.addedAt,
          enabled: t.enabled,
          lastChecked: t.lastChecked || null,
          status: t.status || 'unchecked',
          disableReason: t.disableReason || '',
          quotaInfo: t.quotaInfo || null,
        }));
        return jsonResponse({ tokens: safeTokens, pool_status: poolStatus });
      }

      if (request.method === 'POST') {
        const body = (await request.json()) as { token: string; email?: string; spaceName?: string };
        if (!body.token) return jsonResponse({ error: 'token is required' }, 400);
        try {
          const tokens = await addToken(env.KV, body.token, body.email, body.spaceName);
          return jsonResponse({ ok: true, count: tokens.length });
        } catch (e) {
          return jsonResponse({ error: (e as Error).message }, 400);
        }
      }

      if (request.method === 'DELETE') {
        const body = (await request.json()) as { token: string };
        if (!body.token) return jsonResponse({ error: 'token is required' }, 400);
        const tokens = await removeToken(env.KV, body.token);
        return jsonResponse({ ok: true, count: tokens.length });
      }

      if (request.method === 'PATCH') {
        const body = (await request.json()) as { token: string; enabled?: boolean; email?: string; spaceName?: string };
        if (!body.token) return jsonResponse({ error: 'token is required' }, 400);
        if (body.enabled !== undefined) {
          const tokens = await toggleToken(env.KV, body.token, body.enabled);
          return jsonResponse({ ok: true, count: tokens.length });
        }
        if (body.email !== undefined || body.spaceName !== undefined) {
          try {
            const tokens = await updateToken(env.KV, body.token, { email: body.email, spaceName: body.spaceName });
            return jsonResponse({ ok: true, count: tokens.length });
          } catch (e) {
            return jsonResponse({ error: (e as Error).message }, 400);
          }
        }
        return jsonResponse({ error: 'No update fields provided' }, 400);
      }

      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Admin API - check tokens (validate and auto-disable)
    if (url.pathname === '/admin/check-tokens' && request.method === 'POST') {
      if (!verifyAdmin(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const tokens = await getTokens(env.KV);
      const results: Array<{
        token: string;
        email: string;
        valid: boolean;
        httpStatus: number;
        error?: string;
        disabled: boolean;
      }> = [];

      for (const t of tokens) {
        const check = await checkTokenValidity(t.token);
        const disabled = !check.valid;
        if (check.valid) {
          await updateTokenStatus(env.KV, t.token, 'valid');
        } else {
          await updateTokenStatus(env.KV, t.token, 'invalid', `auto-check: HTTP ${check.httpStatus}`);
        }
        results.push({
          token: t.token,
          email: t.email || '',
          valid: check.valid,
          httpStatus: check.httpStatus,
          error: check.error,
          disabled,
        });
      }

      const invalidCount = results.filter((r) => !r.valid).length;
      return jsonResponse({
        ok: true,
        total: results.length,
        valid: results.length - invalidCount,
        invalid: invalidCount,
        results,
      });
    }

    // Admin API - check single token
    if (url.pathname === '/admin/check-token' && request.method === 'POST') {
      if (!verifyAdmin(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const body = (await request.json()) as { token: string };
      if (!body.token) return jsonResponse({ error: 'token is required' }, 400);

      const [validity, quota] = await Promise.all([
        checkTokenValidity(body.token),
        checkTokenQuota(body.token),
      ]);

      if (validity.valid) {
        await updateTokenStatus(env.KV, body.token, 'valid');
      } else {
        await updateTokenStatus(env.KV, body.token, 'invalid', `auto-check: HTTP ${validity.httpStatus}`);
      }

      if (quota.available) {
        await updateTokenQuota(env.KV, body.token, {
          available: quota.available,
          checkedAt: quota.checkedAt,
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
          plan: quota.plan,
          resetAt: quota.resetAt,
        });
      }

      return jsonResponse({
        ok: true,
        valid: validity.valid,
        httpStatus: validity.httpStatus,
        error: validity.error,
        quota: quota.available ? {
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
          plan: quota.plan,
          resetAt: quota.resetAt,
        } : null,
      });
    }

    // Admin API - check quota for all tokens
    if (url.pathname === '/admin/check-quota' && request.method === 'POST') {
      if (!verifyAdmin(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const tokens = await getTokens(env.KV);
      const results: Array<{
        token: string;
        email: string;
        quota: {
          available: boolean;
          used?: number;
          limit?: number;
          remaining?: number;
          plan?: string;
        };
      }> = [];

      for (const t of tokens) {
        const quota = await checkTokenQuota(t.token);
        if (quota.available) {
          await updateTokenQuota(env.KV, t.token, {
            available: quota.available,
            checkedAt: quota.checkedAt,
            used: quota.used,
            limit: quota.limit,
            remaining: quota.remaining,
            plan: quota.plan,
            resetAt: quota.resetAt,
          });
        }
        results.push({
          token: t.token,
          email: t.email || '',
          quota: {
            available: quota.available,
            used: quota.used,
            limit: quota.limit,
            remaining: quota.remaining,
            plan: quota.plan,
          },
        });
      }

      return jsonResponse({ ok: true, total: results.length, results });
    }

    // Admin API - logs
    if (url.pathname === '/admin/logs' && request.method === 'GET') {
      if (!verifyAdmin(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      const logs = await getLogs(env.KV);
      return jsonResponse({ logs });
    }

    // Anthropic Messages endpoint
    if (url.pathname === '/v1/messages' && request.method === 'POST') {
      const clientKey = extractClientKey(request);
      if (!clientKey) {
        return errorResponse(401, 'authentication_error',
          'Missing API key. Pass it via Authorization: Bearer <token> or x-api-key header.');
      }

      const poolConfig = await buildPoolConfig(env);
      const zoToken = resolveToken(clientKey, env, poolConfig);

      if (zoToken === null) {
        return errorResponse(401, 'authentication_error', 'Invalid API key.');
      }

      if (!zoToken) {
        return errorResponse(503, 'api_error', 'No upstream tokens available.');
      }

      let body: AnthropicRequest;
      try {
        body = (await request.json()) as AnthropicRequest;
      } catch {
        return errorResponse(400, 'invalid_request_error', 'Invalid JSON body.');
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return errorResponse(400, 'invalid_request_error', 'messages is required and must be a non-empty array.');
      }
      if (!body.model) {
        return errorResponse(400, 'invalid_request_error', 'model is required.');
      }

      const maxRetries = poolConfig ? poolConfig.tokens.length : 1;
      const startTime = Date.now();

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const token = attempt === 0 ? zoToken : pickToken(poolConfig!);
        if (!token) {
          return errorResponse(503, 'api_error', 'All upstream tokens are unavailable.');
        }

        try {
          if (body.stream) {
            const resp = buildStreamingResponse(body, token);
            markSuccess(token);
            addLog(env.KV, body.model, 'anthropic', 'ok', Date.now() - startTime).catch(() => {});
            return resp;
          }

          const result = await forwardNonStreaming(body, token);
          markSuccess(token);
          addLog(env.KV, body.model, 'anthropic', 'ok', Date.now() - startTime).catch(() => {});
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          });
        } catch (err) {
          const message = (err as Error).message || 'Internal server error';
          const isAuthError = message.includes('401') || message.includes('403');
          const isRetryable = isAuthError || message.includes('429');

          if (isAuthError && env.KV) {
            autoDisableToken(env.KV, token, `request-error: ${message}`).catch(() => {});
          }

          if (isRetryable && poolConfig) {
            markFailed(token);
            continue;
          }

          addLog(env.KV, body.model, 'anthropic', 'error', Date.now() - startTime, message).catch(() => {});
          const status = message.includes('401') ? 401
            : message.includes('429') ? 429
            : message.includes('403') ? 403
            : 502;
          return errorResponse(status, 'api_error', message);
        }
      }

      addLog(env.KV, body.model, 'anthropic', 'error', Date.now() - startTime, 'All tokens exhausted').catch(() => {});
      return errorResponse(503, 'api_error', 'All upstream tokens exhausted after retries.');
    }

    // OpenAI Chat Completions endpoint
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      const clientKey = extractClientKey(request);
      if (!clientKey) {
        return errorResponse(401, 'authentication_error',
          'Missing API key. Pass it via Authorization: Bearer <token> or x-api-key header.');
      }

      const poolConfig = await buildPoolConfig(env);
      const zoToken = resolveToken(clientKey, env, poolConfig);

      if (zoToken === null) {
        return errorResponse(401, 'authentication_error', 'Invalid API key.');
      }

      if (!zoToken) {
        return errorResponse(503, 'api_error', 'No upstream tokens available.');
      }

      let body: OpenAIChatRequest;
      try {
        body = (await request.json()) as OpenAIChatRequest;
      } catch {
        return errorResponse(400, 'invalid_request_error', 'Invalid JSON body.');
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return errorResponse(400, 'invalid_request_error', 'messages is required and must be a non-empty array.');
      }
      if (!body.model) {
        return errorResponse(400, 'invalid_request_error', 'model is required.');
      }

      const maxRetries = poolConfig ? poolConfig.tokens.length : 1;
      const startTime = Date.now();

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const token = attempt === 0 ? zoToken : pickToken(poolConfig!);
        if (!token) {
          return errorResponse(503, 'api_error', 'All upstream tokens are unavailable.');
        }

        try {
          if (body.stream) {
            const resp = buildOpenAIStreamingResponse(body, token);
            markSuccess(token);
            addLog(env.KV, body.model, 'openai', 'ok', Date.now() - startTime).catch(() => {});
            return resp;
          }

          const result = await forwardOpenAINonStreaming(body, token);
          markSuccess(token);
          addLog(env.KV, body.model, 'openai', 'ok', Date.now() - startTime).catch(() => {});
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          });
        } catch (err) {
          const message = (err as Error).message || 'Internal server error';
          const isAuthError = message.includes('401') || message.includes('403');
          const isRetryable = isAuthError || message.includes('429');

          if (isAuthError && env.KV) {
            autoDisableToken(env.KV, token, `request-error: ${message}`).catch(() => {});
          }

          if (isRetryable && poolConfig) {
            markFailed(token);
            continue;
          }

          addLog(env.KV, body.model, 'openai', 'error', Date.now() - startTime, message).catch(() => {});
          const status = message.includes('401') ? 401
            : message.includes('429') ? 429
            : message.includes('403') ? 403
            : 502;
          return errorResponse(status, 'api_error', message);
        }
      }

      addLog(env.KV, body.model, 'openai', 'error', Date.now() - startTime, 'All tokens exhausted').catch(() => {});
      return errorResponse(503, 'api_error', 'All upstream tokens exhausted after retries.');
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};
