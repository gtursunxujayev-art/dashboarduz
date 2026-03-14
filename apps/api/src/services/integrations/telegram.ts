// Telegram Bot integration service

export class TelegramService {
  private apiUrl = 'https://api.telegram.org/bot';

  async getBotInfo(botToken: string): Promise<{ id: number; username?: string; first_name?: string }> {
    const response = await fetch(`${this.apiUrl}${botToken}/getMe`);
    if (!response.ok) {
      throw new Error('Invalid Telegram bot token');
    }

    const data = await response.json();
    if (!data.ok || !data.result) {
      throw new Error('Failed to fetch Telegram bot info');
    }

    return data.result as { id: number; username?: string; first_name?: string };
  }

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
  async verifyBotToken(botToken: string): Promise<{ isValid: boolean; bot?: { id: number; username?: string; first_name?: string } }> {
    try {
      const bot = await this.getBotInfo(botToken);
      return { isValid: true, bot };
    } catch {
      return { isValid: false };
    }
  }

  // Set webhook for bot
  async setWebhook(botToken: string, webhookUrl: string, secretToken?: string) {
    const response = await fetch(`${this.apiUrl}${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        ...(secretToken ? { secret_token: secretToken } : {}),
        drop_pending_updates: true,
      }),
    });

    return await response.json();
  }
}

export const telegramService = new TelegramService();
