// ネットワークエラー・5xx 時に指数バックオフで最大 retries 回まで自動リトライする fetch ラッパー。
export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  retries = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // 5xx は一時的エラーとみなしてリトライ
      if (res.status >= 500 && attempt < retries) {
        await backoff(attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await backoff(attempt);
        continue;
      }
    }
  }
  throw lastError ?? new Error('fetch failed');
}

function backoff(attempt: number): Promise<void> {
  // 0.5s, 1s, 2s, ...
  const ms = 500 * 2 ** attempt;
  return new Promise((r) => setTimeout(r, ms));
}
