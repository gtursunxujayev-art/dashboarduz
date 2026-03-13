// Telegram Bot integration service

export class TelegramService {
  private apiUrl = 'https://api.telegram.org/bot';

  // Send message via bot
  async sendMessage(botToken: string, chatId: string, text: string, options?: any) {
    const response = await fetch(`${this.apiUrl}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...options,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Telegram API error: ${error.description || 'Unknown error'}`);
    }

    return await response.json();
  }

  // Verify bot token
  async verifyBotToken(botToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}${botToken}/getMe`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Set webhook for bot
  async setWebhook(botToken: string, webhookUrl: string) {
    const response = await fetch(`${this.apiUrl}${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });

    return await response.json();
  }
}

export const telegramService = new TelegramService();
