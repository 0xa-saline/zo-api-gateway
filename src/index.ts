import { forwardNonStreaming, buildStreamingResponse } from './converter';
import { getLandingHTML } from './landing';
import type { AnthropicRequest } from './types';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key, anthropic-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'content-type',
  };
}

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) return apiKey;
  return null;
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    },
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Landing page
    if (url.pathname === '/' && request.method === 'GET') {
      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(getLandingHTML(baseUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }

    // Messages endpoint
    if (url.pathname === '/v1/messages' && request.method === 'POST') {
      const token = extractToken(request);
      if (!token) {
        return errorResponse(401, 'Missing API key. Pass it via Authorization: Bearer <token> or x-api-key header.');
      }

      let body: AnthropicRequest;
      try {
        body = (await request.json()) as AnthropicRequest;
      } catch {
        return errorResponse(400, 'Invalid JSON body.');
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return errorResponse(400, 'messages is required and must be a non-empty array.');
      }
      if (!body.model) {
        return errorResponse(400, 'model is required.');
      }

      try {
        if (body.stream) {
          return buildStreamingResponse(body, token);
        }

        const result = await forwardNonStreaming(body, token);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      } catch (err) {
        const message = (err as Error).message || 'Internal server error';
        const status = message.includes('401') ? 401 : message.includes('429') ? 429 : 502;
        return errorResponse(status, message);
      }
    }

    // 404 for everything else
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};
