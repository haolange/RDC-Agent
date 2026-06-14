/**
 * VoiceService — 语音输入服务 (STT)。
 *
 * 使用 Web Speech API (浏览器端) 或 Whisper API (服务端)。
 */
export interface VoiceResult { text: string; confidence: number; }

export class VoiceService {
  private listening = false;
  private onResult: ((result: VoiceResult) => void) | null = null;
  private recognition: unknown = null;

  /** 检查浏览器是否支持语音识别。 */
  isSupported(): boolean {
    return typeof window !== 'undefined' && !!(window as { SpeechRecognition?: unknown }).SpeechRecognition;
  }

  /** 开始监听语音输入。 */
  startListening(): void {
    if (this.listening) return;
    this.listening = true;

    // 使用 Web Speech API
    if (this.isSupported()) {
      const SpeechRecognition = (window as unknown as { SpeechRecognition: new () => { lang: string; interimResults: boolean; onresult: (e: unknown) => void; onend: () => void; start: () => void } }).SpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;

      recognition.onresult = (event: unknown) => {
        const results = (event as { results: Array<Array<{ transcript: string; confidence: number }>> }).results;
        if (results.length > 0 && results[0].length > 0) {
          this.onResult?.({
            text: results[0][0].transcript,
            confidence: results[0][0].confidence,
          });
        }
      };

      recognition.onend = () => { this.listening = false; };
      recognition.start();
      this.recognition = recognition;
    }
  }

  /** 停止监听。 */
  stopListening(): void {
    this.listening = false;
    if (this.recognition && typeof (this.recognition as { stop?: () => void }).stop === 'function') {
      (this.recognition as { stop: () => void }).stop();
    }
  }

  /** 注册识别结果回调。 */
  setOnResult(callback: (result: VoiceResult) => void): void {
    this.onResult = callback;
  }

  get isListening(): boolean { return this.listening; }
}
