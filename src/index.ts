import { forwardNonStreaming, buildStreamingResponse } from './converter';
import { getLandingHTML } from './landing';
import { getAdminHTML } from './admin';
import { pickToken, markFailed, markSuccess, getPoolStatus } from './key-pool';
import { getTokens, addToken, removeToken, toggleToken, getEnabledTokenStrings } from './token-store';
import type { AnthropicRequest } from './types';
import type { KeyPoolConfig } from './key-pool';

interface Env {
  KV: KVNamespace;
  GATEWAY_KEY?: string;
  ZO_TOKENS?: string;
  COOLDOWN_MS?: string;
}

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

  // KV tokens take priority
  if (env.KV) {
    const kvTokens = await getEnabledTokenStrings(env.KV);
    if (kvTokens.length > 0) {
      return { tokens: kvTokens, cooldownMs };
    }
  }

  // Fall back to env var
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Admin panel page
    if (url.pathname === '/admin' && request.method === 'GET') {
      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(getAdminHTML(baseUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }

    // Admin API routes
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
          label: t.label,
          addedAt: t.addedAt,
          enabled: t.enabled,
        }));
        return jsonResponse({ tokens: safeTokens, pool_status: poolStatus });
      }

      if (request.method === 'POST') {
        const body = (await request.json()) as { token: string; label: string };
        if (!body.token) return jsonResponse({ error: 'token is required' }, 400);
        try {
          const tokens = await addToken(env.KV, body.token, body.label || '未命名');
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
        const body = (await request.json()) as { token: string; enabled: boolean };
        if (!body.token) return jsonResponse({ error: 'token is required' }, 400);
        const tokens = await toggleToken(env.KV, body.token, body.enabled);
        return jsonResponse({ ok: true, count: tokens.length });
      }

      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Landing page
    if (url.pathname === '/' && request.method === 'GET') {
      const baseUrl = `${url.protocol}//${url.host}`;
      const poolConfig = await buildPoolConfig(env);
      const gatewayMode = isGatewayMode(env);
      const poolStatus = poolConfig ? getPoolStatus(poolConfig) : null;
      return new Response(getLandingHTML(baseUrl, gatewayMode, poolStatus), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }

    // Messages endpoint
    if (url.pathname === '/v1/messages' && request.method === 'POST') {
      const clientKey = extractClientKey(request);
      if (!clientKey) {
        return errorResponse(401, 'authentication_error',
          'Missing API key. Pass it via Authorization: Bearer <token> or x-api-key header.');
      }

      const poolConfig = await buildPoolConfig(env);
      const gatewayMode = isGatewayMode(env);

      let zoToken: string | null;
      if (gatewayMode && poolConfig) {
        if (clientKey !== env.GATEWAY_KEY) {
          return errorResponse(401, 'authentication_error', 'Invalid API key.');
        }
        zoToken = pickToken(poolConfig);
      } else {
        zoToken = clientKey;
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

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const token = attempt === 0 ? zoToken : pickToken(poolConfig!);
        if (!token) {
          return errorResponse(503, 'api_error', 'All upstream tokens are unavailable.');
        }

        try {
          if (body.stream) {
            const resp = buildStreamingResponse(body, token);
            markSuccess(token);
            return resp;
          }

          const result = await forwardNonStreaming(body, token);
          markSuccess(token);
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          });
        } catch (err) {
          const message = (err as Error).message || 'Internal server error';
          const isRetryable = message.includes('429') || message.includes('401') || message.includes('403');

          if (isRetryable && poolConfig) {
            markFailed(token);
            continue;
          }

          const status = message.includes('401') ? 401
            : message.includes('429') ? 429
            : message.includes('403') ? 403
            : 502;
          return errorResponse(status, 'api_error', message);
        }
      }

      return errorResponse(503, 'api_error', 'All upstream tokens exhausted after retries.');
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};
