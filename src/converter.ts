import type { AnthropicRequest, AnthropicResponse, AnthropicContentBlock, ZoAskRequest, OpenAIChatRequest, OpenAIChatResponse, OpenAIStreamChunk } from './types';

const ZO_API_BASE = 'https://api.zo.computer';

export class UpstreamError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Zo API error ${status}: ${body}`);
    this.name = 'UpstreamError';
    this.status = status;
    this.body = body;
  }
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // length / 4 is a rough estimate for mixed CJK + ASCII content; not authoritative.
  return Math.ceil(text.length / 4);
}

function applyStopSequences(
  text: string,
  stopSequences: string[] | undefined,
): { text: string; matched: string | null } {
  if (!stopSequences || stopSequences.length === 0) return { text, matched: null };
  let earliest = -1;
  let matched: string | null = null;
  for (const seq of stopSequences) {
    if (!seq) continue;
    const idx = text.indexOf(seq);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
      matched = seq;
    }
  }
  if (earliest === -1 || matched === null) return { text, matched: null };
  return { text: text.slice(0, earliest), matched };
}

function applyMaxTokens(
  text: string,
  maxTokens: number | undefined,
): { text: string; truncated: boolean } {
  if (!maxTokens || maxTokens <= 0) return { text, truncated: false };
  // Inverse of estimateTokens: assume max_tokens * 4 characters cap.
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function extractTextContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content;
  // Only text blocks are forwarded to the Zo backend: it does not accept image
  // or thinking blocks. See README "Known Limitations".
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

export function anthropicToZo(req: AnthropicRequest): { zoReq: ZoAskRequest; inputText: string } {
  const inputText = formatMessagesToInput(req);
  const zoReq: ZoAskRequest = {
    input: inputText,
    model_name: resolveModelName(req.model),
    stream: req.stream ?? false,
  };
  // Allow advanced clients to bypass the default Zo persona by passing
  // metadata.persona_id (see README).
  const personaId = req.metadata && typeof req.metadata === 'object'
    ? (req.metadata as Record<string, unknown>).persona_id
    : undefined;
  if (typeof personaId === 'string' && personaId.length > 0) {
    zoReq.persona_id = personaId;
  }
  return { zoReq, inputText };
}

export function zoToAnthropic(
  zoOutput: string,
  model: string,
  req: AnthropicRequest,
  inputText: string,
): AnthropicResponse {
  let text = zoOutput;
  let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' = 'end_turn';
  let stopSequence: string | null = null;

  // Honor stop_sequences client-side, since the Zo backend does not.
  const stopResult = applyStopSequences(text, req.stop_sequences);
  if (stopResult.matched) {
    text = stopResult.text;
    stopReason = 'stop_sequence';
    stopSequence = stopResult.matched;
  }

  // Honor max_tokens client-side, since the Zo backend does not.
  const maxResult = applyMaxTokens(text, req.max_tokens);
  if (maxResult.truncated) {
    text = maxResult.text;
    // max_tokens takes precedence over stop_sequence if it triggers first.
    if (stopReason === 'end_turn') {
      stopReason = 'max_tokens';
      stopSequence = null;
    }
  }

  return {
    id: generateMessageId(),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: {
      input_tokens: estimateTokens(inputText),
      output_tokens: estimateTokens(text),
    },
  };
}

export async function forwardNonStreaming(
  req: AnthropicRequest,
  token: string,
): Promise<AnthropicResponse> {
  const { zoReq, inputText } = anthropicToZo(req);
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
    throw new UpstreamError(resp.status, body);
  }

  const zoResp = (await resp.json()) as { output: string };
  return zoToAnthropic(zoResp.output, req.model, req, inputText);
}

export function buildStreamingResponse(
  req: AnthropicRequest,
  token: string,
): Response {
  const { zoReq, inputText } = anthropicToZo(req);
  zoReq.stream = true;
  const model = req.model;
  const msgId = generateMessageId();
  const inputTokens = estimateTokens(inputText);
  const maxChars = req.max_tokens && req.max_tokens > 0 ? req.max_tokens * 4 : Infinity;
  const stopSequences = (req.stop_sequences || []).filter((s) => !!s);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (event: string, data: Record<string, unknown>) => {
    return writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    let textBlockOpen = false;
    let thinkingBlockOpen = false;
    let textIndex = 0;
    let accumulatedText = '';
    let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' = 'end_turn';
    let stopSequence: string | null = null;

    const openTextBlock = async () => {
      if (textBlockOpen) return;
      if (thinkingBlockOpen) {
        await write('content_block_stop', { type: 'content_block_stop', index: textIndex });
        thinkingBlockOpen = false;
        textIndex += 1;
      }
      await write('content_block_start', {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'text', text: '' },
      });
      textBlockOpen = true;
    };

    const openThinkingBlock = async () => {
      if (thinkingBlockOpen) return;
      if (textBlockOpen) {
        await write('content_block_stop', { type: 'content_block_stop', index: textIndex });
        textBlockOpen = false;
        textIndex += 1;
      }
      await write('content_block_start', {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'thinking', thinking: '' },
      });
      thinkingBlockOpen = true;
    };

    const emitTextDelta = async (chunk: string): Promise<boolean> => {
      // Returns true if the stream should stop (max_tokens / stop_sequence hit).
      if (!chunk) return false;
      await openTextBlock();

      let toEmit = chunk;
      const projectedLen = accumulatedText.length + toEmit.length;
      if (projectedLen > maxChars) {
        toEmit = toEmit.slice(0, Math.max(0, maxChars - accumulatedText.length));
        accumulatedText += toEmit;
        if (toEmit) {
          await write('content_block_delta', {
            type: 'content_block_delta',
            index: textIndex,
            delta: { type: 'text_delta', text: toEmit },
          });
        }
        stopReason = 'max_tokens';
        stopSequence = null;
        return true;
      }

      accumulatedText += toEmit;
      await write('content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: toEmit },
      });

      // Check for stop_sequences against the accumulated text.
      if (stopSequences.length > 0) {
        let earliest = -1;
        let matched: string | null = null;
        for (const seq of stopSequences) {
          const idx = accumulatedText.indexOf(seq);
          if (idx !== -1 && (earliest === -1 || idx < earliest)) {
            earliest = idx;
            matched = seq;
          }
        }
        if (matched !== null && earliest !== -1) {
          // Note: we already emitted past the stop_sequence in this delta — fidelity
          // is best-effort because the upstream Zo backend does not honor stop_sequences.
          stopReason = 'stop_sequence';
          stopSequence = matched;
          return true;
        }
      }
      return false;
    };

    const emitThinkingDelta = async (chunk: string) => {
      if (!chunk) return;
      await openThinkingBlock();
      await write('content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'thinking_delta', thinking: chunk },
      });
    };

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
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
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
      let eventType = '';
      let shouldStop = false;

      while (!shouldStop) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (shouldStop) break;
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              const partKind = data.part?.part_kind;
              const partContent = data.part?.content;
              const deltaKind = data.delta?.part_delta_kind;
              const deltaContent = data.delta?.content_delta;

              if (eventType === 'PartStartEvent' && partKind === 'text' && partContent) {
                shouldStop = await emitTextDelta(partContent);
              } else if (eventType === 'PartDeltaEvent' && deltaKind === 'text' && deltaContent) {
                shouldStop = await emitTextDelta(deltaContent);
              } else if (eventType === 'PartStartEvent' && (partKind === 'thinking' || partKind === 'reasoning') && partContent) {
                await emitThinkingDelta(partContent);
              } else if (eventType === 'PartDeltaEvent' && (deltaKind === 'thinking' || deltaKind === 'reasoning') && deltaContent) {
                await emitThinkingDelta(deltaContent);
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

      // Best-effort: ask upstream to close. The reader.cancel() is ignored on errors.
      try { reader.cancel(); } catch { /* ignore */ }

      // Close any open content_block
      if (textBlockOpen || thinkingBlockOpen) {
        await write('content_block_stop', { type: 'content_block_stop', index: textIndex });
        textBlockOpen = false;
        thinkingBlockOpen = false;
      } else {
        // Open and immediately close an empty text block so the SSE shape stays valid
        // even for zero-output responses (e.g. upstream returned nothing).
        await write('content_block_start', {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        });
        await write('content_block_stop', { type: 'content_block_stop', index: textIndex });
      }

      // Send message_delta
      await write('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: stopSequence },
        usage: { output_tokens: estimateTokens(accumulatedText) },
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

function zoToOpenAI(
  zoOutput: string,
  model: string,
  req: OpenAIChatRequest,
  inputText: string,
): OpenAIChatResponse {
  let text = zoOutput;
  let finishReason: 'stop' | 'length' = 'stop';

  // Honor stop sequences client-side, since the Zo backend does not.
  const stopList = typeof req.stop === 'string'
    ? [req.stop]
    : Array.isArray(req.stop) ? req.stop : undefined;
  const stopResult = applyStopSequences(text, stopList);
  if (stopResult.matched) {
    text = stopResult.text;
  }

  const maxResult = applyMaxTokens(text, req.max_tokens);
  if (maxResult.truncated) {
    text = maxResult.text;
    finishReason = 'length';
  }

  const promptTokens = estimateTokens(inputText);
  const completionTokens = estimateTokens(text);
  return {
    id: generateChatId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export async function forwardOpenAINonStreaming(
  req: OpenAIChatRequest,
  token: string,
): Promise<OpenAIChatResponse> {
  const zoReq = openaiToZo(req);
  zoReq.stream = false;
  const inputText = zoReq.input;

  const resp = await fetch(`${ZO_API_BASE}/zo/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(zoReq),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new UpstreamError(resp.status, body);
  }

  const zoResp = (await resp.json()) as { output: string };
  return zoToOpenAI(zoResp.output, req.model, req, inputText);
}

export function buildOpenAIStreamingResponse(
  req: OpenAIChatRequest,
  token: string,
): Response {
  const zoReq = openaiToZo(req);
  zoReq.stream = true;
  const model = req.model;
  const chatId = generateChatId();
  const maxChars = req.max_tokens && req.max_tokens > 0 ? req.max_tokens * 4 : Infinity;
  const stopList = typeof req.stop === 'string'
    ? [req.stop]
    : Array.isArray(req.stop) ? req.stop.filter((s) => !!s) : [];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const writeSSE = (data: string) => {
    return writer.write(encoder.encode(`data: ${data}\n\n`));
  };

  (async () => {
    let accumulatedText = '';
    let finishReason: 'stop' | 'length' = 'stop';

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
      let eventType = '';
      let shouldStop = false;

      while (!shouldStop) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (shouldStop) break;
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
                let toEmit = text;
                if (accumulatedText.length + toEmit.length > maxChars) {
                  toEmit = toEmit.slice(0, Math.max(0, maxChars - accumulatedText.length));
                  finishReason = 'length';
                  shouldStop = true;
                }
                if (toEmit) {
                  accumulatedText += toEmit;
                  const chunk: OpenAIStreamChunk = {
                    id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
                    model, choices: [{ index: 0, delta: { content: toEmit }, finish_reason: null }],
                  };
                  await writeSSE(JSON.stringify(chunk));
                }
                if (!shouldStop && stopList.length > 0) {
                  for (const seq of stopList) {
                    if (accumulatedText.indexOf(seq) !== -1) {
                      shouldStop = true;
                      // finish_reason stays 'stop' for stop-sequence hits per OpenAI spec.
                      break;
                    }
                  }
                }
              }
            } catch { /* skip malformed */ }
            eventType = '';
          }
        }
      }

      try { reader.cancel(); } catch { /* ignore */ }

      const endChunk: OpenAIStreamChunk = {
        id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
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
