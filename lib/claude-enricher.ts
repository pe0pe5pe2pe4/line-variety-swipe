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

/** 1件を加工。失敗時は null（呼び出し側で元説明にフォールバック）。 */
export async function enrichOne(input: EnrichInput): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 256,
      messages: [{ role: 'user', content: buildPrompt(input) }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    // 80文字上限を念のためクライアント側でも担保
    return text ? text.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** 複数件を順次加工（レート制御のため直列）。 */
export async function enrichBatch(
  inputs: (EnrichInput & { id: string })[]
): Promise<{ id: string; enriched: string }[]> {
  const out: { id: string; enriched: string }[] = [];
  for (const input of inputs) {
    const enriched = await enrichOne(input);
    if (enriched) out.push({ id: input.id, enriched });
  }
  return out;
}
