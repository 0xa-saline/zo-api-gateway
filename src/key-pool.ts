export type DispatchStrategy = 'round-robin' | 'sticky';

export interface KeyPoolConfig {
  tokens: string[];
  cooldownMs: number;
  strategy: DispatchStrategy;
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
let stickyToken: string | null = null;

function getAvailable(tokens: string[], cooldownMs: number): string[] {
  const now = Date.now();
  const available: string[] = [];
  for (const token of tokens) {
    const state = getState(token);
    if (state.failedAt === 0 || now - state.failedAt > cooldownMs) {
      available.push(token);
    }
  }
  return available;
}

export function pickToken(config: KeyPoolConfig): string | null {
  const { tokens, cooldownMs, strategy } = config;
  if (tokens.length === 0) return null;

  let available = getAvailable(tokens, cooldownMs);

  if (available.length === 0) {
    resetAll(tokens);
    available = tokens;
  }

  if (strategy === 'sticky') {
    if (stickyToken && available.includes(stickyToken)) {
      return stickyToken;
    }
    stickyToken = available[0];
    return stickyToken;
  }

  return available[roundRobinIndex++ % available.length];
}

export function markFailed(token: string): void {
  const state = getState(token);
  state.failedAt = Date.now();
  state.failCount++;
  if (stickyToken === token) {
    stickyToken = null;
  }
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

export function getPoolStatus(config: KeyPoolConfig): { total: number; available: number; strategy: DispatchStrategy; stickyToken: string | null } {
  const available = getAvailable(config.tokens, config.cooldownMs).length;
  return {
    total: config.tokens.length,
    available,
    strategy: config.strategy,
    stickyToken: config.strategy === 'sticky' ? stickyToken : null,
  };
}
