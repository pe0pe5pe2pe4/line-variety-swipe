import Anthropic from '@anthropic-ai/sdk';

// 番組概要を Claude API で「思わずスワイプしたくなる」紹介文に加工する。
// コスト最適化のため新規コンテンツのみ・バッチ処理で呼び出すこと（呼び出し側で制御）。

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export type EnrichInput = {
  title: string;
  description?: string | null;
  genre?: string | null;
};

function buildPrompt(input: EnrichInput): string {
  return `以下のテレビ番組・動画の情報を読んで、10〜20代〜30代の視聴者が思わずスワイプしたくなる魅力的な紹介文を2〜3文で書いてください。

番組名：${input.title}
元の説明：${input.description ?? ''}
ジャンル：${input.genre ?? ''}

条件：
- 絵文字を1〜2個使う
- 「神回」「ヤバい」「思わず」などの感情を引く言葉を使う
- ネタバレはしない
- 体言止めで終わる
- 最大80文字以内

紹介文のみを出力してください（前置き・引用符なし）。`;
}

/** 1件を加工。失敗時は例外を投げる（呼び出し側でログ・error収集する）。 */
export async function enrichOne(input: EnrichInput): Promise<string | null> {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not set');

  // 短い紹介文の生成なので高速・低コストの Haiku を使用（Opusだと20件で
  // タイムアウトするため）。1呼び出し15秒でタイムアウト。
  const response = await client.messages.create(
    {
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: buildPrompt(input) }],
    },
    { timeout: 15000 }
  );

  // 安全分類によるリフューザル（Opus系では稀だが念のため）
  if (response.stop_reason === 'refusal') {
    throw new Error('refused by safety classifier');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!text) {
    console.warn('[enrich] empty text, stop_reason=', response.stop_reason);
    return null;
  }
  // 80文字上限を念のためクライアント側でも担保
  return text.slice(0, 80);
}

export type EnrichResult = {
  results: { id: string; enriched: string }[];
  errors: { id: string; error: string }[];
};

const CONCURRENCY = 5;

/** 複数件を並列(最大5)で加工。タイムアウト回避のため直列にしない。エラーは収集して返す。 */
export async function enrichBatch(inputs: (EnrichInput & { id: string })[]): Promise<EnrichResult> {
  const results: { id: string; enriched: string }[] = [];
  const errors: { id: string; error: string }[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < inputs.length) {
      const input = inputs[cursor++];
      try {
        const enriched = await enrichOne(input);
        if (enriched) results.push({ id: input.id, enriched });
        else errors.push({ id: input.id, error: 'empty response' });
      } catch (e) {
        const err = e as { status?: number; message?: string };
        const msg = err.status ? `${err.status}: ${err.message ?? ''}` : err.message ?? String(e);
        console.error('[enrich] failed for', input.id, msg);
        errors.push({ id: input.id, error: msg });
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, inputs.length) }, () => worker());
  await Promise.all(workers);
  return { results, errors };
}
