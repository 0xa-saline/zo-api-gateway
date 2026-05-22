const ZO_API_BASE = 'https://api.zo.computer';

export interface TokenCheckResult {
  valid: boolean;
  httpStatus: number;
  error?: string;
  checkedAt: number;
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


