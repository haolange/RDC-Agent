/**
 * Buddy — 终端虚拟宠物 (ASCII art)。
 */
import React, { useState, useEffect } from 'react';

const SPECIES: Record<string, { ascii: string; frames: string[] }> = {
  cat: { ascii: '🐱', frames: ['(^・ω・^)', '(=^ェ^=)', '(^・x・^)'] },
  dog: { ascii: '🐕', frames: ['(ᵔᴥᵔ)', 'U^ｪ^U', '(◕ᴥ◕)'] },
  owl: { ascii: '🦉', frames: ['(◉▿◉)', '(◉ω◉)', '(◉_◉)'] },
  rabbit: { ascii: '🐰', frames: ['(\\_/)', '(•_•)', '(>_<)'] },
};

type Rarity = 'common' | 'rare' | 'legendary';
const RARITY_COLORS: Record<Rarity, string> = { common: '#888', rare: '#4af', legendary: '#f80' };

export const Buddy: React.FC = () => {
  const [species] = useState(() => Object.keys(SPECIES)[Math.floor(Math.random() * Object.keys(SPECIES).length)]);
  const [rarity] = useState<Rarity>(() => Math.random() < 0.02 ? 'legendary' : Math.random() < 0.15 ? 'rare' : 'common');
  const [frame, setFrame] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % (SPECIES[species]?.frames.length ?? 1));
    }, 3000);
    return () => clearInterval(interval);
  }, [visible, species]);

  if (!visible) return null;

  const info = SPECIES[species];
  const currentFace = info?.frames[frame] ?? '(・_・)';

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, opacity: 0.7,
      fontFamily: 'monospace', fontSize: 16, color: RARITY_COLORS[rarity],
      zIndex: 1000, userSelect: 'none', cursor: 'pointer',
    }} title={`${rarity} ${species}`}>
      {rarity === 'legendary' && <span>✨</span>}
      {currentFace} {info.ascii}
    </div>
  );
};
