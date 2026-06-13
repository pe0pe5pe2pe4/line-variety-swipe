'use client';
import { useState, useRef } from 'react';

type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

type Props = {
  content: Content;
  onSwipe: (direction: 'left' | 'right') => void;
};

export default function SwipeCard({ content, onSwipe }: Props) {
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    startX.current = e.clientX;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset(e.clientX - startX.current);
  };

  const handleMouseUp = () => {
    setDragging(false);
    if (offset > 100) onSwipe('right');
    else if (offset < -100) onSwipe('left');
    setOffset(0);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ transform: `translateX(${offset}px) rotate(${offset * 0.05}deg)` }}
      className="absolute w-80 bg-white rounded-2xl shadow-xl overflow-hidden cursor-grab select-none transition-transform"
    >
      <img 
  src={content.thumbnail_url || 'https://placehold.co/320x256?text=No+Image'} 
  alt={content.title} 
  className="w-full h-64 object-cover" 
/>
      <div className="p-4">
        <h2 className="text-xl font-bold">{content.title}</h2>
        <p className="text-sm text-gray-500 mt-1 line-clamp-3">{content.description}</p>
      </div>
      <div className="flex justify-between px-6 py-3">
        <button onClick={() => onSwipe('left')} className="text-red-400 text-3xl">✕</button>
        <button onClick={() => onSwipe('right')} className="text-green-400 text-3xl">♥</button>
      </div>
    </div>
  );
}