'use client';
import ContentImage from './ContentImage';

export type TopProgram = {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name?: string | null;
  content_type?: string | null;
  count: number;
};

export type Stats = {
  totalSwipes: number;
  thisWeekCount: number;
  topPrograms: TopProgram[];
  genreRanking: { name: string; count: number }[];
  stationRanking: { name: string; count: number }[];
  weeklyTopPrograms?: TopProgram[];
  tastePercentile?: { genre: string; topPercent: number } | null;
};

type Props = {
  stats: Stats | null;
  loading: boolean;
};

function RankingList({
  title,
  emoji,
  items,
}: {
  title: string;
  emoji: string;
  items: { name: string; count: number }[];
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="bg-slate-800/60 rounded-2xl p-4">
      <h2 className="text-white font-bold text-sm mb-3">
        {emoji} {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-slate-500 text-xs">まだデータがありません</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.slice(0, 5).map((item, i) => (
            <div key={item.name} className="flex items-center gap-3">
              <span className="text-slate-400 text-xs w-4 text-center">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-slate-200 text-sm truncate">{item.name}</span>
                  <span className="text-indigo-300 text-xs font-bold ml-2">{item.count}</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-indigo-400 h-1.5 rounded-full"
                    style={{ width: `${(item.count / max) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyPage({ stats, loading }: Props) {
  if (loading) {
    return (
      <div className="flex justify-center mt-10">
        <div className="w-10 h-10 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center text-slate-400 text-sm mt-10 px-8">
        統計を取得できませんでした
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4 pb-4 flex flex-col gap-4">
      {/* 好み傾向 */}
      {stats.tastePercentile && (
        <div className="bg-gradient-to-br from-purple-500/30 to-indigo-700/20 rounded-2xl p-4 text-center">
          <p className="text-slate-300 text-xs">あなたの好み傾向</p>
          <p className="text-white text-lg font-black mt-1">
            「{stats.tastePercentile.genre}」好きの上位 {stats.tastePercentile.topPercent}%
          </p>
        </div>
      )}

      {/* サマリーカード */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-indigo-500/30 to-indigo-700/20 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black text-white">{stats.totalSwipes}</p>
          <p className="text-slate-300 text-xs mt-1">総スワイプ数</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/30 to-emerald-700/20 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black text-white">{stats.thisWeekCount}</p>
          <p className="text-slate-300 text-xs mt-1">今週スワイプした番組</p>
        </div>
      </div>

      {/* 好きな番組TOP5 */}
      <div className="bg-slate-800/60 rounded-2xl p-4">
        <h2 className="text-white font-bold text-sm mb-3">❤️ 好きな番組 TOP5</h2>
        {stats.topPrograms.length === 0 ? (
          <p className="text-slate-500 text-xs">右スワイプするとここに表示されます</p>
        ) : (
          <div className="flex flex-col gap-3">
            {stats.topPrograms.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="text-indigo-300 font-black text-lg w-5 text-center">{i + 1}</span>
                <div className="relative w-12 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-slate-700">
                  <ContentImage
                    src={p.thumbnail_url}
                    alt={p.title}
                    channelName={p.channel_name ?? undefined}
                    sizes="48px"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold line-clamp-2 leading-tight">{p.title}</p>
                  {p.channel_name && (
                    <p className="text-slate-400 text-xs truncate mt-0.5">{p.channel_name}</p>
                  )}
                </div>
                <span className="text-slate-400 text-xs flex-shrink-0">×{p.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 今週のトレンド（全ユーザーで最も右スワイプされた番組） */}
      {stats.weeklyTopPrograms && stats.weeklyTopPrograms.length > 0 && (
        <div className="bg-slate-800/60 rounded-2xl p-4">
          <h2 className="text-white font-bold text-sm mb-3">🔥 今週みんなが選んだ番組 TOP5</h2>
          <div className="flex flex-col gap-3">
            {stats.weeklyTopPrograms.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="text-orange-300 font-black text-lg w-5 text-center">{i + 1}</span>
                <div className="relative w-12 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-slate-700">
                  <ContentImage src={p.thumbnail_url} alt={p.title} channelName={p.channel_name ?? undefined} sizes="48px" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold line-clamp-2 leading-tight">{p.title}</p>
                  {p.channel_name && (
                    <p className="text-slate-400 text-xs truncate mt-0.5">{p.channel_name}</p>
                  )}
                </div>
                <span className="text-slate-400 text-xs flex-shrink-0">♥{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ジャンル・放送局ランキング */}
      <RankingList title="好きなジャンル" emoji="🎭" items={stats.genreRanking} />
      <RankingList title="好きな放送局・チャンネル" emoji="📡" items={stats.stationRanking} />
    </div>
  );
}
