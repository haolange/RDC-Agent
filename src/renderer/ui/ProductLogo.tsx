import { useEffect, useLayoutEffect, useRef } from 'react';
import { maskLogoCircleRgba, recolorLogoRgba } from '@shared/theme/recolorLogo';
import logoUrl from '../../../resources/brand/rdc-agent-logo.png';
import { useAsyncValue } from '../lib/useAsyncValue';
import './ProductLogo.css';

const LOGO_SIZE = 128;
let source: Promise<HTMLImageElement> | undefined;

function loadLogo(): Promise<HTMLImageElement> {
  return source ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { source = undefined; reject(new Error('Product logo could not be loaded.')); };
    image.src = logoUrl;
  });
}

export function ProductLogo({ accent, className = '' }: { accent: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logo = useAsyncValue('logo', loadLogo);
  useEffect(() => {
    if (logo.status === 'error') console.error(logo.error);
  }, [logo]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || logo.status !== 'ready') return;
    canvas.width = LOGO_SIZE;
    canvas.height = LOGO_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    context.drawImage(logo.value, 0, 0, LOGO_SIZE, LOGO_SIZE);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    recolorLogoRgba(frame.data, accent);
    maskLogoCircleRgba(frame.data, canvas.width, canvas.height);
    context.putImageData(frame, 0, 0);
  }, [accent, logo]);
  return <canvas ref={canvasRef} className={`product-logo ${className}`.trim()} aria-hidden="true" />;
}
