export type ChannelConfig = {
  name: string;
  id?: string;          // channel ID (UC...) if known
  searchQuery?: string; // find channel ID by name search → then fetch videos
  videoQuery?: string;  // direct video keyword search (no channel ID)
  category: 'tv_official' | 'comedian';
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

// 後方互換（既存コードが YOUTUBE_CHANNELS をインポートしている箇所向け）
export const YOUTUBE_CHANNELS: ChannelConfig[] = [...TV_CHANNELS, ...COMEDIAN_CHANNELS];
