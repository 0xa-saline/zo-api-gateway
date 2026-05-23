import type { AnthropicRequest, AnthropicResponse, AnthropicContentBlock, ZoAskRequest, OpenAIChatRequest, OpenAIChatResponse, OpenAIStreamChunk } from './types';

const ZO_API_BASE = 'https://api.zo.computer';

function extractTextContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

function formatMessagesToInput(req: AnthropicRequest): string {
  const parts: string[] = [];

  if (req.system) {
    const sysText = typeof req.system === 'string'
      ? req.system
      : extractTextContent(req.system);
    parts.push(`[System]\n${sysText}`);
  }

  for (const msg of req.messages) {
    const role = msg.role === 'user' ? 'Human' : 'Assistant';
    const text = extractTextContent(msg.content);
    parts.push(`[${role}]\n${text}`);
  }

  return parts.join('\n\n');
}

function resolveModelName(model: string): string {
  if (model.includes(':')) return model;
  return `anthropic:${model}`;
}

function generateMessageId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'msg_';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function anthropicToZo(req: AnthropicRequest): ZoAskRequest {
  return {
    input: formatMessagesToInput(req),
    model_name: resolveModelName(req.model),
    stream: req.stream ?? false,
  };
}

export function zoToAnthropic(zoOutput: string, model: string): AnthropicResponse {
  const outputTokens = Math.ceil(zoOutput.length / 4);
  return {
    id: generateMessageId(),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: zoOutput }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: outputTokens },
  };
}

export async function forwardNonStreaming(
  req: AnthropicRequest,
  token: string,
): Promise<AnthropicResponse> {
  const zoReq = anthropicToZo(req);
  zoReq.stream = false;

  const resp = await fetch(`${ZO_API_BASE}/zo/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(zoReq),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Zo API error ${resp.status}: ${body}`);
  }

  const zoResp = (await resp.json()) as { output: string };
  return zoToAnthropic(zoResp.output, req.model);
}

export function buildStreamingResponse(
  req: AnthropicRequest,
  token: string,
): Response {
  const zoReq = anthropicToZo(req);
  zoReq.stream = true;
  const model = req.model;
  const msgId = generateMessageId();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (event: string, data: Record<string, unknown>) => {
    return writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    try {
      // Send message_start
      await write('message_start', {
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      // Send content_block_start
      await write('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });

      // Fetch streaming from Zo
      const resp = await fetch(`${ZO_API_BASE}/zo/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(zoReq),
      });

      if (!resp.ok) {
        const body = await resp.text();
        await write('error', { type: 'error', error: { type: 'api_error', message: `Zo API error ${resp.status}: ${body}` } });
        await writer.close();
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'PartStartEvent' && data.part?.part_kind === 'text' && data.part?.content) {
                outputTokens += Math.ceil(data.part.content.length / 4);
                await write('content_block_delta', {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: data.part.content },
                });
              } else if (eventType === 'PartDeltaEvent' && data.delta?.part_delta_kind === 'text' && data.delta?.content_delta) {
                outputTokens += Math.ceil(data.delta.content_delta.length / 4);
                await write('content_block_delta', {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: data.delta.content_delta },
                });
              } else if (eventType === 'FrontendModelResponse' && data.parts) {
                // Legacy: final aggregated response
              } else if (eventType === 'End') {
                // Stream completed
              } else if (eventType === 'Error') {
                await write('error', {
                  type: 'error',
                  error: { type: 'api_error', message: data.message || 'Unknown error' },
                });
              }
            } catch {
              // Skip malformed JSON
            }
            eventType = '';
          }
        }
      }

      // Send content_block_stop
      await write('content_block_stop', {
        type: 'content_block_stop',
        index: 0,
      });

      // Send message_delta
      await write('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });

      // Send message_stop
      await write('message_stop', { type: 'message_stop' });

      await writer.close();
    } catch (err) {
      try {
        await write('error', {
          type: 'error',
          error: { type: 'api_error', message: (err as Error).message },
        });
        await writer.close();
      } catch {
        // Writer already closed
      }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// OpenAI Chat Completions support

function resolveOpenAIModel(model: string): string {
  // Strip zo: prefix: zo:anthropic/claude-opus-4-7 → anthropic/claude-opus-4-7
  if (model.startsWith('zo:')) {
    model = model.slice(3);
  }
  // Convert slash to colon: anthropic/claude-opus-4-7 → anthropic:claude-opus-4-7
  if (model.includes('/')) {
    model = model.replace('/', ':');
  }
  // Bare model name without provider: claude-opus-4-7 → anthropic:claude-opus-4-7
  if (!model.includes(':')) {
    model = `anthropic:${model}`;
  }
  return model;
}

function openaiToZo(req: OpenAIChatRequest): ZoAskRequest {
  const parts: string[] = [];
  for (const msg of req.messages) {
    const role = msg.role === 'user' ? 'Human' : msg.role === 'system' ? 'System' : 'Assistant';
    parts.push(`[${role}]\n${msg.content}`);
  }
  return {
    input: parts.join('\n\n'),
    model_name: resolveOpenAIModel(req.model),
    stream: req.stream ?? false,
  };
}

function generateChatId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'chatcmpl-';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function zoToOpenAI(zoOutput: string, model: string): OpenAIChatResponse {
  const tokens = Math.ceil(zoOutput.length / 4);
  return {
    id: generateChatId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: zoOutput },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: tokens, total_tokens: tokens },
  };
}

export async function forwardOpenAINonStreaming(
  req: OpenAIChatRequest,
  token: string,
): Promise<OpenAIChatResponse> {
  const zoReq = openaiToZo(req);
  zoReq.stream = false;

  const resp = await fetch(`${ZO_API_BASE}/zo/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(zoReq),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Zo API error ${resp.status}: ${body}`);
  }

  const zoResp = (await resp.json()) as { output: string };
  return zoToOpenAI(zoResp.output, req.model);
}

export function buildOpenAIStreamingResponse(
  req: OpenAIChatRequest,
  token: string,
): Response {
  const zoReq = openaiToZo(req);
  zoReq.stream = true;
  const model = req.model;
  const chatId = generateChatId();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const writeSSE = (data: string) => {
    return writer.write(encoder.encode(`data: ${data}\n\n`));
  };

  (async () => {
    try {
      const startChunk: OpenAIStreamChunk = {
        id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      };
      await writeSSE(JSON.stringify(startChunk));

      const resp = await fetch(`${ZO_API_BASE}/zo/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(zoReq),
      });

      if (!resp.ok) {
        const body = await resp.text();
        const errChunk = { error: { message: `Zo API error ${resp.status}: ${body}`, type: 'api_error' } };
        await writeSSE(JSON.stringify(errChunk));
        await writeSSE('[DONE]');
        await writer.close();
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              let text = '';
              if (eventType === 'PartStartEvent' && data.part?.part_kind === 'text' && data.part?.content) {
                text = data.part.content;
              } else if (eventType === 'PartDeltaEvent' && data.delta?.part_delta_kind === 'text' && data.delta?.content_delta) {
                text = data.delta.content_delta;
              }
              if (text) {
                const chunk: OpenAIStreamChunk = {
                  id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
                  model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                };
                await writeSSE(JSON.stringify(chunk));
              }
            } catch { /* skip malformed */ }
            eventType = '';
          }
        }
      }

      const endChunk: OpenAIStreamChunk = {
        id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      await writeSSE(JSON.stringify(endChunk));
      await writeSSE('[DONE]');
      await writer.close();
    } catch (err) {
      try {
        await writeSSE(JSON.stringify({ error: { message: (err as Error).message, type: 'api_error' } }));
        await writeSSE('[DONE]');
        await writer.close();
      } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
