/**
 * useStreamingText — 流式文本渲染 Hook。
 *
 * 使用 StreamBuffer 按帧批量更新文本，减少渲染开销。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { StreamBuffer } from '../stream/StreamBuffer';

export function useStreamingText() {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const bufferRef = useRef<StreamBuffer | null>(null);

  useEffect(() => {
    bufferRef.current = new StreamBuffer((batched) => {
      setText((prev) => prev + batched);
    });
    return () => {
      bufferRef.current?.destroy();
    };
  }, []);

  const startStream = useCallback(() => {
    setText('');
    setIsStreaming(true);
  }, []);

  const appendChunk = useCallback((delta: string) => {
    bufferRef.current?.append(delta);
  }, []);

  const endStream = useCallback(() => {
    bufferRef.current?.flush();
    setIsStreaming(false);
  }, []);

  return { text, isStreaming, startStream, appendChunk, endStream };
}
