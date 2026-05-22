const ZO_API_BASE = 'https://api.zo.computer';

export interface TokenCheckResult {
  valid: boolean;
  httpStatus: number;
  error?: string;
  checkedAt: number;
}

export interface TokenQuotaResult {
  available: boolean;
  checkedAt: number;
  used?: number;
  limit?: number;
  remaining?: number;
  plan?: string;
  resetAt?: string;
  raw?: Record<string, unknown>;
}

export async function checkTokenValidity(token: string): Promise<TokenCheckResult> {
  const checkedAt = Date.now();
  try {
    const resp = await fetch(`${ZO_API_BASE}/zo/spaces`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (resp.ok) {
      return { valid: true, httpStatus: resp.status, checkedAt };
    }

    if (resp.status === 401 || resp.status === 403) {
      const body = await resp.text().catch(() => '');
      return { valid: false, httpStatus: resp.status, error: body || `HTTP ${resp.status}`, checkedAt };
    }

    // 5xx or other errors — server issue, not necessarily invalid
    return { valid: true, httpStatus: resp.status, checkedAt };
  } catch (err) {
    // Network error — can't determine validity, assume valid
    return { valid: true, httpStatus: 0, error: (err as Error).message, checkedAt };
  }
}

export async function checkTokenQuota(token: string): Promise<TokenQuotaResult> {
  const checkedAt = Date.now();
  try {
    const resp = await fetch(`${ZO_API_BASE}/zo/usage`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      return { available: false, checkedAt };
    }

    const data = (await resp.json()) as Record<string, unknown>;

    const result: TokenQuotaResult = { available: true, checkedAt, raw: data };
    if (typeof data.used === 'number') result.used = data.used;
    if (typeof data.limit === 'number') result.limit = data.limit;
    if (typeof data.remaining === 'number') result.remaining = data.remaining;
    if (typeof data.plan === 'string') result.plan = data.plan;
    if (typeof data.reset_at === 'string') result.resetAt = data.reset_at;

    // derive remaining if not provided
    if (result.remaining === undefined && result.limit !== undefined && result.used !== undefined) {
      result.remaining = result.limit - result.used;
    }

    return result;
  } catch {
    return { available: false, checkedAt };
  }
}

export interface BatchCheckResult {
  token: string;
  validity: TokenCheckResult;
  quota: TokenQuotaResult;
}

export async function batchCheckTokens(tokens: string[]): Promise<BatchCheckResult[]> {
  const results: BatchCheckResult[] = [];
  // Process tokens sequentially to avoid rate limiting
  for (const token of tokens) {
    const [validity, quota] = await Promise.all([
      checkTokenValidity(token),
      checkTokenQuota(token),
    ]);
    results.push({ token, validity, quota });
  }
  return results;
}
