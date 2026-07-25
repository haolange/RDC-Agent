/**
 * Buddy — 终端虚拟宠物 (ASCII art)。
 */
import React, { useState, useEffect } from 'react';
import './Buddy.css';

const SPECIES: Record<string, { ascii: string; frames: string[] }> = {
  cat: { ascii: '🐱', frames: ['(^・ω・^)', '(=^ェ^=)', '(^・x・^)'] },
  dog: { ascii: '🐕', frames: ['(ᵔᴥᵔ)', 'U^ｪ^U', '(◕ᴥ◕)'] },
  owl: { ascii: '🦉', frames: ['(◉▿◉)', '(◉ω◉)', '(◉_◉)'] },
  rabbit: { ascii: '🐰', frames: ['(\\_/)', '(•_•)', '(>_<)'] },
};

type Rarity = 'common' | 'rare' | 'legendary';

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
    <div
      className="buddy-pet"
      data-rarity={rarity}
      title={`${rarity} ${species}`}
    >
      {rarity === 'legendary' && <span>✨</span>}
      {currentFace} {info.ascii}
    </div>
  );
};
