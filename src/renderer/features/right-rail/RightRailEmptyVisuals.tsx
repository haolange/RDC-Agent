import React from 'react';
import { cn } from '../../lib/cn';
import type { RightRailEmptyKind } from './RightRailEmptyState';
import './RightRailEmptyVisuals.css';

/**
 * Right rail empty-state illustrations: isometric token-tinted scenes.
 * Gradient stops resolve through `.rr-eg-{tone}-hi/lo` classes so the
 * blocks adapt to light/dark. Blur stays light to fit the restrained language.
 */

const ISO_RY = 0.5774;

const glassGradient = (id: string, tone: string) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" className={`rr-eg-${tone}-hi`} />
    <stop offset="1" className={`rr-eg-${tone}-lo`} />
  </linearGradient>
);

const softBlur = (id: string, deviation = 1.4) => (
  <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation={deviation} />
  </filter>
);

const GroundShadow: React.FC<{ cx: number; cy: number; rx: number; ry: number; blurId: string }> = ({ cx, cy, rx, ry, blurId }) => (
  <ellipse className="rr-eg-shadow" cx={cx} cy={cy} rx={rx} ry={ry} filter={`url(#${blurId})`} />
);

/** Isometric glass box: (cx, cy) is the top-face center; faces shade via overlay classes. */
const IsoBox: React.FC<{ cx: number; cy: number; rx: number; h: number; fill: string }> = ({ cx, cy, rx, h, fill }) => {
  const ry = Math.round(rx * ISO_RY * 100) / 100;
  const n = `${cx},${cy - ry}`;
  const e = `${cx + rx},${cy}`;
  const s = `${cx},${cy + ry}`;
  const w = `${cx - rx},${cy}`;
  const left = `M${w} L${s} L${cx},${cy + ry + h} L${cx - rx},${cy + h} Z`;
  const right = `M${e} L${s} L${cx},${cy + ry + h} L${cx + rx},${cy + h} Z`;
  const top = `M${n} L${e} L${s} L${w} Z`;
  return (
    <g>
      <path d={right} fill={fill} />
      <path d={left} fill={fill} />
      <path className="rr-eg-face-shade" d={left} />
      <path d={top} fill={fill} />
      <path className="rr-eg-face-sheen" d={top} />
      <path className="rr-eg-edge" d={top} />
    </g>
  );
};

const ProgressVisual: React.FC = () => {
  const blur = 'rr-eg-progress-blur';
  const glow = 'rr-eg-progress-glow';
  const steps: Array<{ cx: number; cy: number; h: number; tone: string }> = [
    { cx: 40, cy: 66.76, h: 16, tone: 'blue' },
    { cx: 80, cy: 56.76, h: 26, tone: 'sky' },
    { cx: 120, cy: 46.76, h: 36, tone: 'green' },
    { cx: 160, cy: 34.76, h: 48, tone: 'amber' },
  ];
  return (
    <svg className="right-rail-empty-visual progress-visual" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        {glassGradient('rr-eg-progress-blue', 'blue')}
        {glassGradient('rr-eg-progress-sky', 'sky')}
        {glassGradient('rr-eg-progress-green', 'green')}
        {glassGradient('rr-eg-progress-amber', 'amber')}
        {softBlur(blur)}
        {softBlur(glow, 1.2)}
      </defs>
      <polyline className="rr-eg-thread" points="40,66.8 80,56.8 120,46.8 160,34.8" />
      {steps.map(({ cx }) => (
        <GroundShadow key={`shadow-${cx}`} cx={cx} cy={93.5} rx={21} ry={4.6} blurId={blur} />
      ))}
      {steps.map(({ cx, cy, h, tone }) => (
        <IsoBox key={cx} cx={cx} cy={cy} rx={16} h={h} fill={`url(#rr-eg-progress-${tone})`} />
      ))}
      <circle className={cn('rr-eg-active-glow')} cx={160} cy={34.76} r={7} filter={`url(#${glow})`} />
      <circle className={cn('rr-eg-active-core')} cx={160} cy={34.76} r={3.2} />
    </svg>
  );
};

const OutputsVisual: React.FC = () => {
  const blur = 'rr-eg-outputs-blur';
  return (
    <svg className="right-rail-empty-visual output-visual" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        {glassGradient('rr-eg-outputs-sky', 'sky')}
        {glassGradient('rr-eg-outputs-purple', 'purple')}
        {softBlur(blur)}
      </defs>
      <rect className="rr-eg-tray" x={30} y={68} width={140} height={30} rx={9} />
      <GroundShadow cx={77} cy={83} rx={22} ry={4.4} blurId={blur} />
      <GroundShadow cx={140} cy={80} rx={15} ry={3.6} blurId={blur} />
      <g transform="rotate(-6 78 44)">
        <rect className="rr-eg-doc-back" x={63} y={17} width={34} height={44} rx={6} fill="url(#rr-eg-outputs-sky)" />
        <rect x={60} y={20} width={34} height={44} rx={6} fill="url(#rr-eg-outputs-sky)" />
        <rect className="rr-eg-edge" x={60} y={20} width={34} height={44} rx={6} />
        <path className="rr-eg-doc-fold" d="M86 20 L94 28 L86 28 Z" />
        <rect className="rr-eg-doc-mark" x={66} y={34} width={18} height={3} rx={1.5} />
        <rect className="rr-eg-doc-mark" x={66} y={41} width={22} height={3} rx={1.5} />
        <rect className="rr-eg-doc-mark" x={66} y={48} width={13} height={3} rx={1.5} />
      </g>
      <IsoBox cx={140} cy={48} rx={13} h={14} fill="url(#rr-eg-outputs-purple)" />
    </svg>
  );
};

const ContextVisual: React.FC = () => {
  const blur = 'rr-eg-context-blur';
  return (
    <svg className="right-rail-empty-visual context-visual" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        {glassGradient('rr-eg-context-purple', 'purple')}
        {glassGradient('rr-eg-context-sky', 'sky')}
        {glassGradient('rr-eg-context-pink', 'pink')}
        <linearGradient id="rr-eg-context-link-left" gradientUnits="userSpaceOnUse" x1={46} y1={71.1} x2={100} y2={47.6}>
          <stop offset="0" className="rr-eg-purple-hi" />
          <stop offset="1" className="rr-eg-sky-hi" />
        </linearGradient>
        <linearGradient id="rr-eg-context-link-right" gradientUnits="userSpaceOnUse" x1={154} y1={53.1} x2={100} y2={47.6}>
          <stop offset="0" className="rr-eg-pink-hi" />
          <stop offset="1" className="rr-eg-sky-hi" />
        </linearGradient>
        {softBlur(blur)}
      </defs>
      <GroundShadow cx={100} cy={89.5} rx={22} ry={4.8} blurId={blur} />
      <GroundShadow cx={46} cy={95.5} rx={14} ry={3.4} blurId={blur} />
      <GroundShadow cx={154} cy={83.5} rx={14} ry={3.4} blurId={blur} />
      <line className="rr-eg-link-glow" x1={46} y1={71.07} x2={100} y2={47.6} filter={`url(#${blur})`} />
      <line className="rr-eg-link-glow" x1={154} y1={53.07} x2={100} y2={47.6} filter={`url(#${blur})`} />
      <line className="rr-eg-link" x1={46} y1={71.07} x2={100} y2={47.6} stroke="url(#rr-eg-context-link-left)" />
      <line className="rr-eg-link" x1={154} y1={53.07} x2={100} y2={47.6} stroke="url(#rr-eg-context-link-right)" />
      <IsoBox cx={46} cy={71.07} rx={12} h={16} fill="url(#rr-eg-context-purple)" />
      <IsoBox cx={154} cy={53.07} rx={12} h={22} fill="url(#rr-eg-context-pink)" />
      <IsoBox cx={100} cy={47.6} rx={18} h={30} fill="url(#rr-eg-context-sky)" />
      <circle className="rr-eg-node" cx={46} cy={71.07} r={2.8} />
      <circle className="rr-eg-node" cx={154} cy={53.07} r={2.8} />
      <circle className="rr-eg-node" cx={100} cy={47.6} r={3.2} />
    </svg>
  );
};

const ArtifactsVisual: React.FC = () => {
  const blur = 'rr-eg-artifacts-blur';
  return (
    <svg className="right-rail-empty-visual artifacts-visual" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        {glassGradient('rr-eg-artifacts-purple', 'purple')}
        {glassGradient('rr-eg-artifacts-sky', 'sky')}
        {glassGradient('rr-eg-artifacts-amber', 'amber')}
        <linearGradient id="rr-eg-artifacts-link" gradientUnits="userSpaceOnUse" x1={52} y1={70} x2={148} y2={46}>
          <stop offset="0" className="rr-eg-purple-hi" />
          <stop offset="1" className="rr-eg-amber-hi" />
        </linearGradient>
        {softBlur(blur)}
      </defs>
      <GroundShadow cx={70} cy={92} rx={24} ry={5} blurId={blur} />
      <GroundShadow cx={118} cy={86} rx={20} ry={4.4} blurId={blur} />
      <GroundShadow cx={148} cy={78} rx={16} ry={3.6} blurId={blur} />
      <line className="rr-eg-link-glow" x1={70} y1={58} x2={118} y2={50} filter={`url(#${blur})`} />
      <line className="rr-eg-link-glow" x1={118} y1={50} x2={148} y2={42} filter={`url(#${blur})`} />
      <line className="rr-eg-link" x1={70} y1={58} x2={148} y2={42} stroke="url(#rr-eg-artifacts-link)" />
      <IsoBox cx={70} cy={58} rx={20} h={22} fill="url(#rr-eg-artifacts-purple)" />
      <IsoBox cx={118} cy={50} rx={16} h={18} fill="url(#rr-eg-artifacts-sky)" />
      <IsoBox cx={148} cy={42} rx={13} h={14} fill="url(#rr-eg-artifacts-amber)" />
      <circle className="rr-eg-node" cx={70} cy={58} r={2.8} />
      <circle className="rr-eg-node" cx={118} cy={50} r={2.6} />
      <circle className="rr-eg-node" cx={148} cy={42} r={2.4} />
    </svg>
  );
};

const CaptureVisual: React.FC = () => {
  const blur = 'rr-eg-capture-blur';
  return (
    <svg className="right-rail-empty-visual capture-visual" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        {glassGradient('rr-eg-capture-blue', 'blue')}
        <radialGradient id="rr-eg-capture-badge" cx="0.35" cy="0.3" r="0.95">
          <stop offset="0" className="rr-eg-glass-hi" />
          <stop offset="1" className="rr-eg-sky-lo" />
        </radialGradient>
        <radialGradient id="rr-eg-capture-sheen" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="rr-eg-glass-hi" />
          <stop offset="1" className="rr-eg-glass-fade" />
        </radialGradient>
        {softBlur(blur)}
      </defs>
      <GroundShadow cx={84} cy={89} rx={38} ry={6} blurId={blur} />
      <GroundShadow cx={150} cy={72} rx={15} ry={3.8} blurId={blur} />
      <IsoBox cx={84} cy={50} rx={34} h={18} fill="url(#rr-eg-capture-blue)" />
      <ellipse cx={76} cy={45} rx={15} ry={5.5} fill="url(#rr-eg-capture-sheen)" />
      <circle className="rr-eg-rec-glow" cx={68} cy={44} r={6} filter={`url(#${blur})`} />
      <circle className="rr-eg-rec" cx={68} cy={44} r={3} />
      <circle cx={150} cy={42} r={15} fill="url(#rr-eg-capture-badge)" />
      <circle className="rr-eg-edge" cx={150} cy={42} r={15} />
      <path className="rr-eg-play" d="M145.5 35.5 L157 42 L145.5 48.5 Z" />
    </svg>
  );
};

export const RightRailEmptyVisual: React.FC<{ kind: RightRailEmptyKind }> = ({ kind }) => {
  if (kind === 'progress') return <ProgressVisual />;
  if (kind === 'artifacts') return <ArtifactsVisual />;
  if (kind === 'outputs') return <OutputsVisual />;
  if (kind === 'context') return <ContextVisual />;
  return <CaptureVisual />;
};
