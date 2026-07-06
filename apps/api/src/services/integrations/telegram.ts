// Telegram Bot integration service

const TELEGRAM_REQUEST_TIMEOUT_MS = 6_000;
const TELEGRAM_REQUEST_ATTEMPTS = 3;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function describeNetworkError(error: unknown): string {
  const requestError = error as Error & {
    cause?: {
      code?: string;
      syscall?: string;
      hostname?: string;
      address?: string;
      port?: number;
      message?: string;
    };
  };
  const cause = requestError?.cause;
  const details = [
    cause?.code,
    cause?.syscall,
    cause?.hostname || cause?.address,
    cause?.port,
  ].filter((value) => value !== undefined && value !== null && value !== '');
  const baseMessage = cause?.message || requestError?.message || String(error);
  return details.length > 0 ? `${baseMessage} (${details.join(' ')})` : baseMessage;
}

export class TelegramService {
  private apiUrl = 'https://api.telegram.org/bot';

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= TELEGRAM_REQUEST_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        const retryableStatus = response.status === 429 || response.status >= 500;
        if (!retryableStatus || attempt === TELEGRAM_REQUEST_ATTEMPTS) {
          return response;
        }
        lastError = new Error(`Telegram API temporarily unavailable: HTTP ${response.status}`);
        console.warn('[Telegram] Transient API response; retrying request.', {
          attempt,
          maxAttempts: TELEGRAM_REQUEST_ATTEMPTS,
          status: response.status,
        });
        await response.body?.cancel();
      } catch (error) {
        lastError = error;
        if (attempt === TELEGRAM_REQUEST_ATTEMPTS) {
          break;
        }
        console.warn('[Telegram] Network request failed; retrying request.', {
          attempt,
          maxAttempts: TELEGRAM_REQUEST_ATTEMPTS,
          error: describeNetworkError(error),
        });
      } finally {
        clearTimeout(timeout);
      }

      await sleep(500 * (2 ** (attempt - 1)));
    }

    throw new Error(`Telegram network error after ${TELEGRAM_REQUEST_ATTEMPTS} attempts: ${describeNetworkError(lastError)}`);
  }

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
    const response = await this.fetchWithRetry(`${this.apiUrl}${botToken}/sendMessage`, {
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

  async sendDocument(
    botToken: string,
    chatId: string,
    documentBuffer: Buffer,
    fileName: string,
    caption?: string,
  ) {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (caption) {
      formData.append('caption', caption);
    }
    const binary = new Uint8Array(documentBuffer);
    formData.append('document', new Blob([binary], { type: 'application/pdf' }), fileName);

    const response = await fetch(`${this.apiUrl}${botToken}/sendDocument`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorDescription = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json() as { description?: string };
        errorDescription = errorBody.description || errorDescription;
      } catch {
        // Ignore JSON parsing failures and keep the HTTP status fallback.
      }
      throw new Error(`Telegram API error: ${errorDescription}`);
    }

    return await response.json();
  }
}

export const telegramService = new TelegramService();
