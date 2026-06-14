/**
 * TelegramAdapter — Telegram 消息桥接适配器。
 */
export interface TelegramConfig { botToken: string; allowedChatIds: string[]; }

export class TelegramAdapter {
  private config: TelegramConfig;
  private polling = false;
  private onMessage: ((text: string, chatId: string) => void) | null = null;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig) { this.config = config; }

  /** 启动轮询。 */
  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    void this.poll();
  }

  /** 发送消息到指定 chat。 */
  async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'Markdown' }),
    });
  }

  /** 注册消息回调。 */
  setOnMessage(cb: (text: string, chatId: string) => void): void { this.onMessage = cb; }
  stop(): void { this.polling = false; }

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const url = `https://api.telegram.org/bot${this.config.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`;
        const res = await fetch(url);
        const data = (await res.json()) as { result?: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
        for (const update of data.result ?? []) {
          this.lastUpdateId = update.update_id;
          const chatId = update.message?.chat.id;
          const text = update.message?.text;
          if (chatId && text && this.config.allowedChatIds.includes(String(chatId))) {
            this.onMessage?.(text, String(chatId));
          }
        }
      } catch { await this.sleep(5000); }
    }
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
