import type { AnthropicRequest, AnthropicResponse, AnthropicContentBlock, ZoAskRequest, OpenAIChatRequest, OpenAIChatResponse, OpenAIStreamChunk, OpenAITool, OpenAIToolCall, OpenAIMessage } from './types';

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

const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-7': 'anthropic:claude-opus-4-7',
  'claude-sonnet-4-6': 'anthropic:claude-sonnet-4-6',
  'gpt-5.3-codex': 'openai:gpt-5.3-codex',
  'gpt-5.4': 'openai:gpt-5.4',
  'gpt-5.5': 'openai:gpt-5.5',
  'gpt-5.4-mini': 'openai:gpt-5.4-mini',
  'deepseek-v4-pro': 'deepseek:deepseek-v4-pro',
  'glm-5': 'zai:glm-5',
  'minimax-m2.5': 'minimax:minimax-m2.5',
  'minimax-m2.7': 'minimax:minimax-m2.7',
  'gemini-3.1-pro-preview': 'google:gemini-3.1-pro-preview',
};

function resolveZoModelName(model: string): string {
  const alias = MODEL_ALIASES[model];
  if (alias) return alias;

  if (model.startsWith('zo:')) model = model.slice(3);
  if (model.includes('/')) model = model.replace('/', ':');
  if (model.includes(':')) return model;

  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4') || model.startsWith('chatgpt')) {
    return `openai:${model}`;
  }
  if (model.startsWith('deepseek')) return `deepseek:${model}`;
  if (model.startsWith('glm')) return `zai:${model}`;
  if (model.startsWith('minimax')) return `minimax:${model}`;
  if (model.startsWith('gemini')) return `google:${model}`;
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
    model_name: resolveZoModelName(req.model),
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
  return resolveZoModelName(model);
}

function formatToolsPrompt(tools: OpenAITool[]): string {
  const defs = tools.map((t) => {
    const f = t.function;
    let s = `- ${f.name}`;
    if (f.description) s += `: ${f.description}`;
    if (f.parameters) s += `\n  Parameters: ${JSON.stringify(f.parameters)}`;
    return s;
  }).join('\n');
  return [
    '# Tool Use Instructions',
    'You have access to the following tools. When you need to use a tool, you MUST respond with ONLY a JSON block wrapped in <tool_call> tags.',
    'You can make multiple tool calls. Format each call exactly as:',
    '<tool_call>{"name": "function_name", "arguments": {"arg1": "value1"}}</tool_call>',
    '',
    'Available tools:',
    defs,
    '',
    'IMPORTANT: When you decide to use a tool, your ENTIRE response must consist of <tool_call> blocks only, with no other text before or after them.',
    'If you do not need to call any tool, respond normally without <tool_call> tags.',
  ].join('\n');
}

function generateToolCallId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'call_';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function parseToolCalls(text: string): { toolCalls: OpenAIToolCall[]; textContent: string } {
  const toolCalls: OpenAIToolCall[] = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      toolCalls.push({
        id: generateToolCallId(),
        type: 'function',
        function: {
          name: parsed.name,
          arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments ?? {}),
        },
      });
    } catch {
      // skip malformed tool call
    }
  }
  const textContent = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  return { toolCalls, textContent };
}

function formatMessageContent(msg: OpenAIMessage): string {
  if (msg.role === 'tool') {
    return `[Tool Result (${msg.name ?? msg.tool_call_id ?? 'unknown'})]\n${msg.content ?? ''}`;
  }
  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    const calls = msg.tool_calls.map((tc) =>
      `<tool_call>${JSON.stringify({ name: tc.function.name, arguments: JSON.parse(tc.function.arguments) })}</tool_call>`
    ).join('\n');
    return msg.content ? `${msg.content}\n${calls}` : calls;
  }
  return msg.content ?? '';
}

function openaiToZo(req: OpenAIChatRequest): ZoAskRequest {
  const parts: string[] = [];
  const hasTools = req.tools && req.tools.length > 0;
  const toolsPrompt = hasTools ? formatToolsPrompt(req.tools!) : '';

  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i];
    const role = msg.role === 'user' ? 'Human'
      : msg.role === 'system' ? 'System'
      : msg.role === 'tool' ? 'Tool'
      : 'Assistant';
    let content = formatMessageContent(msg);
    // Inject tool instructions into the last user message so the model sees them inline
    if (hasTools && msg.role === 'user' && i === req.messages.length - 1) {
      content = `${toolsPrompt}\n\n---\n\n${content}`;
    }
    parts.push(`[${role}]\n${content}`);
  }
  // Fallback: if no user message at the end, prepend tool instructions as System block
  if (hasTools && (req.messages.length === 0 || req.messages[req.messages.length - 1].role !== 'user')) {
    parts.unshift(`[System]\n${toolsPrompt}`);
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
  let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';

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

  const hasTools = req.tools && req.tools.length > 0;
  if (hasTools) {
    const { toolCalls, textContent } = parseToolCalls(text);
    if (toolCalls.length > 0) {
      return {
        id: generateChatId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: textContent || null,
            tool_calls: toolCalls,
          },
          finish_reason: 'tool_calls',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    }
  }

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
  const hasTools = req.tools && req.tools.length > 0;
  // When tools are present, use non-streaming to reliably parse tool calls from the complete response
  zoReq.stream = !hasTools;
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

      if (hasTools) {
        // Non-streaming path for tool calls: read entire response, parse tool calls, emit as SSE
        const zoResp = (await resp.json()) as { output: string };
        let text = zoResp.output;

        const stopResult = applyStopSequences(text, stopList.length > 0 ? stopList : undefined);
        if (stopResult.matched) text = stopResult.text;
        const maxResult = applyMaxTokens(text, req.max_tokens);
        if (maxResult.truncated) text = maxResult.text;

        const { toolCalls, textContent } = parseToolCalls(text);

        if (toolCalls.length > 0) {
          if (textContent) {
            const contentChunk: OpenAIStreamChunk = {
              id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
              model, choices: [{ index: 0, delta: { content: textContent }, finish_reason: null }],
            };
            await writeSSE(JSON.stringify(contentChunk));
          }
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const toolChunk: OpenAIStreamChunk = {
              id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
              model, choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: i,
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.function.name, arguments: tc.function.arguments },
                  }],
                },
                finish_reason: null,
              }],
            };
            await writeSSE(JSON.stringify(toolChunk));
          }
          const endChunk: OpenAIStreamChunk = {
            id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
            model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          };
          await writeSSE(JSON.stringify(endChunk));
        } else {
          if (text) {
            const contentChunk: OpenAIStreamChunk = {
              id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
              model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            };
            await writeSSE(JSON.stringify(contentChunk));
          }
          const endChunk: OpenAIStreamChunk = {
            id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
            model, choices: [{ index: 0, delta: {}, finish_reason: maxResult.truncated ? 'length' : 'stop' }],
          };
          await writeSSE(JSON.stringify(endChunk));
        }
        await writeSSE('[DONE]');
        await writer.close();
        return;
      }

      // Standard streaming path (no tools)
      let accumulatedText = '';
      let finishReason: 'stop' | 'length' = 'stop';

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
