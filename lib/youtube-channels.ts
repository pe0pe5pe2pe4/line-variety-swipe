// YouTubeチャンネル設定
// チャンネルIDがわかっているものはidを指定、不明な場合はsearchQueryで番組名検索にフォールバック
export type ChannelConfig = {
  name: string;
  // channel ID (UC...) がわかっていれば指定
  id?: string;
  // IDが不明またはIDが間違っていた場合の検索クエリ
  searchQuery?: string;
  // カテゴリ分類
  category: 'tv_official' | 'comedian' | 'youtuber';
};

export const YOUTUBE_CHANNELS: ChannelConfig[] = [
  // テレビ局公式
  {
    name: '日テレ公式',
    id: 'UCuTAXTexrFvpXMfaX58Fkgg',
    searchQuery: '日テレ公式 バラエティ',
    category: 'tv_official',
  },
  {
    name: 'TBS公式',
    id: 'UCkDDKxHmQZ6B3cnKqvwVKAg',
    searchQuery: 'TBS公式 バラエティ',
    category: 'tv_official',
  },
  {
    name: 'フジテレビ公式',
    id: 'UCzmHoMcNnFDK8QHNNXS1hpQ',
    searchQuery: 'フジテレビ公式 バラエティ',
    category: 'tv_official',
  },
  {
    name: 'テレビ朝日公式',
    id: 'UCE9P4MaJRq9ytU47YBa07mw',
    searchQuery: 'テレビ朝日公式 バラエティ',
    category: 'tv_official',
  },
  {
    name: 'テレビ東京公式',
    id: 'UCwEFCEHMdJTDzI5Y0JEGbEw',
    searchQuery: 'テレビ東京公式 バラエティ',
    category: 'tv_official',
  },
  // 芸人チャンネル
  {
    name: '千鳥のKOCチャンネル',
    searchQuery: '千鳥 KOC チャンネル site:youtube.com',
    category: 'comedian',
  },
  {
    name: 'かまいたちチャンネル',
    searchQuery: 'かまいたちチャンネル',
    category: 'comedian',
  },
  {
    name: '霜降り明星',
    searchQuery: '霜降り明星 公式',
    category: 'comedian',
  },
  {
    name: 'EXIT',
    searchQuery: 'EXIT りんたろー兼近 チャンネル',
    category: 'comedian',
  },
  {
    name: 'ニューヨーク',
    searchQuery: 'ニューヨーク 嶋佐 屋敷 チャンネル',
    category: 'comedian',
  },
  // バラエティ系YouTuber
  {
    name: 'ヒカキンTV',
    searchQuery: 'ヒカキンTV',
    category: 'youtuber',
  },
  {
    name: '東海オンエア',
    searchQuery: '東海オンエア',
    category: 'youtuber',
  },
  {
    name: 'フィッシャーズ',
    searchQuery: 'フィッシャーズ Fisher\'s',
    category: 'youtuber',
  },
  {
    name: 'よりひと',
    searchQuery: 'よりひと チャンネル',
    category: 'youtuber',
  },
  {
    name: 'スカイピース',
    searchQuery: 'スカイピース SkyPeace',
    category: 'youtuber',
  },
];
