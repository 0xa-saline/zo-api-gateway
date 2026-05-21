export interface KeyPoolConfig {
  tokens: string[];
  cooldownMs: number;
}

interface TokenState {
  token: string;
  failedAt: number;
  failCount: number;
}

const tokenStates = new Map<string, TokenState>();

function getState(token: string): TokenState {
  let state = tokenStates.get(token);
  if (!state) {
    state = { token, failedAt: 0, failCount: 0 };
    tokenStates.set(token, state);
  }
  return state;
}

let roundRobinIndex = 0;

export function pickToken(config: KeyPoolConfig): string | null {
  const { tokens, cooldownMs } = config;
  if (tokens.length === 0) return null;

  const now = Date.now();
  const available: string[] = [];

  for (const token of tokens) {
    const state = getState(token);
    if (state.failedAt === 0 || now - state.failedAt > cooldownMs) {
      available.push(token);
    }
  }

  if (available.length === 0) {
    resetAll(tokens);
    return tokens[roundRobinIndex++ % tokens.length];
  }

  return available[roundRobinIndex++ % available.length];
}

export function markFailed(token: string): void {
  const state = getState(token);
  state.failedAt = Date.now();
  state.failCount++;
}

export function markSuccess(token: string): void {
  const state = getState(token);
  state.failedAt = 0;
  state.failCount = 0;
}

function resetAll(tokens: string[]): void {
  for (const token of tokens) {
    const state = getState(token);
    state.failedAt = 0;
  }
}

export function getPoolStatus(config: KeyPoolConfig): { total: number; available: number } {
  const now = Date.now();
  let available = 0;
  for (const token of config.tokens) {
    const state = getState(token);
    if (state.failedAt === 0 || now - state.failedAt > config.cooldownMs) {
      available++;
    }
  }
  return { total: config.tokens.length, available };
}
