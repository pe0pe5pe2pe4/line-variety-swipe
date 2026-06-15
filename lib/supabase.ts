import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase env vars not set');
    _client = createClient(url, key);
  }
  return _client;
}

// backward compat shim — removed after all callers migrated
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** クエリ実行時間を計測してログ出力する（遅いクエリ特定用）。 */
export async function timed<T>(label: string, p: PromiseLike<T>): Promise<T> {
  const t0 = Date.now();
  const r = await p;
  const ms = Date.now() - t0;
  if (ms > 300) console.warn(`[supabase] SLOW ${label}: ${ms}ms`);
  else console.log(`[supabase] ${label}: ${ms}ms`);
  return r;
}
