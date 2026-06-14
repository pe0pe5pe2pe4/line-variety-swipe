'use client';

// ローディング中に表示するスケルトンカード（カードと同じ縦型フルスクリーン形状）
export default function SkeletonCard() {
  return (
    <div className="relative w-full max-w-sm" style={{ height: 'min(640px, calc(100dvh - 180px))' }}>
      <div className="absolute inset-0 rounded-3xl overflow-hidden bg-slate-800 animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded-full bg-slate-600" />
            <div className="h-5 w-20 rounded-full bg-slate-600" />
          </div>
          <div className="h-7 w-3/4 rounded bg-slate-600" />
          <div className="h-4 w-1/2 rounded bg-slate-700" />
          <div className="flex justify-center gap-6 pt-2">
            <div className="w-[56px] h-[56px] rounded-full bg-slate-600" />
            <div className="w-[48px] h-[48px] rounded-full bg-slate-600" />
            <div className="w-[56px] h-[56px] rounded-full bg-slate-600" />
          </div>
        </div>
      </div>
    </div>
  );
}
