export type ChannelConfig = {
  name: string;
  id?: string;          // channel ID (UC...) if known
  searchQuery?: string; // find channel ID by name search → then fetch videos
  videoQuery?: string;  // direct video keyword search (no channel ID)
  category: 'tv_official' | 'comedian' | 'discovery';
  order: 'viewCount' | 'date';
};

// テレビ局公式：再生回数上位10本を取得
export const TV_CHANNELS: ChannelConfig[] = [
  {
    name: '日テレ公式',
    id: 'UCuTAXTexrFvpXMfaX58Fkgg',
    searchQuery: '日テレ公式',
    category: 'tv_official',
    order: 'viewCount',
  },
  {
    name: 'TBS公式',
    id: 'UCkDDKxHmQZ6B3cnKqvwVKAg',
    searchQuery: 'TBS公式',
    category: 'tv_official',
    order: 'viewCount',
  },
  {
    name: 'フジテレビ公式',
    id: 'UCzmHoMcNnFDK8QHNNXS1hpQ',
    searchQuery: 'フジテレビ公式',
    category: 'tv_official',
    order: 'viewCount',
  },
  {
    name: 'テレビ朝日公式',
    id: 'UCE9P4MaJRq9ytU47YBa07mw',
    searchQuery: 'テレビ朝日公式',
    category: 'tv_official',
    order: 'viewCount',
  },
  {
    name: 'テレビ東京公式',
    id: 'UCwEFCEHMdJTDzI5Y0JEGbEw',
    searchQuery: 'テレビ東京公式',
    category: 'tv_official',
    order: 'viewCount',
  },
];

// 芸人チャンネル：最新10本を取得
// 公式チャンネルがある芸人は searchQuery でチャンネルIDを自動解決
// 公式チャンネルがない場合は videoQuery で直接動画検索
export const COMEDIAN_CHANNELS: ChannelConfig[] = [
  {
    name: '千鳥',
    searchQuery: '千鳥 公式チャンネル',
    category: 'comedian',
    order: 'date',
  },
  {
    name: 'かまいたち',
    searchQuery: 'かまいたちチャンネル',
    category: 'comedian',
    order: 'date',
  },
  {
    name: '霜降り明星',
    searchQuery: '霜降り明星',
    category: 'comedian',
    order: 'date',
  },
  {
    name: 'ダウンタウン',
    // ダウンタウンは専用公式チャンネルなし → 動画キーワード検索
    videoQuery: 'ダウンタウン バラエティ 公式 TBS フジテレビ',
    category: 'comedian',
    order: 'date',
  },
  {
    name: '有吉',
    // 有吉は専用公式チャンネルなし → 動画キーワード検索
    videoQuery: '有吉弘行 バラエティ 公式 日テレ TBS',
    category: 'comedian',
    order: 'date',
  },
];

// 発掘チャンネル：埋もれた地下芸人・深夜番組・無名YouTuberを掘り起こす。
// order:'date'（新着順＝再生回数バイアスが弱い）でキーワード直接検索し、
// まだ知られていない動画を corpus に取り込む。
export const DISCOVERY_CHANNELS: ChannelConfig[] = [
  { name: '地下芸人', videoQuery: '地下芸人 ネタ ライブ', category: 'discovery', order: 'date' },
  { name: 'インディーズ芸人', videoQuery: 'インディーズ芸人 漫才 コント', category: 'discovery', order: 'date' },
  { name: '無名芸人ネタ', videoQuery: '無名 芸人 ネタ おもしろい', category: 'discovery', order: 'date' },
  { name: '深夜番組', videoQuery: '深夜番組 バラエティ 神回', category: 'discovery', order: 'date' },
  { name: '個人バラエティ', videoQuery: '個人 バラエティ 企画 おもしろ', category: 'discovery', order: 'date' },
  { name: '若手お笑い', videoQuery: '若手 お笑い ネタ 初配信', category: 'discovery', order: 'date' },
  { name: 'ローカル番組', videoQuery: 'ローカル番組 バラエティ おもしろ', category: 'discovery', order: 'date' },
  { name: 'ドッキリ個人', videoQuery: 'ドッキリ 個人 企画 検証', category: 'discovery', order: 'date' },
];

// 後方互換（既存コードが YOUTUBE_CHANNELS をインポートしている箇所向け）
export const YOUTUBE_CHANNELS: ChannelConfig[] = [...TV_CHANNELS, ...COMEDIAN_CHANNELS, ...DISCOVERY_CHANNELS];
