import { z } from 'zod';

// AmoCRM integration
export const amocrmConnectSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

export const amocrmWebhookSchema = z.object({
  account: z.object({
    id: z.string(),
  }),
  leads: z.array(z.any()).optional(),
  contacts: z.array(z.any()).optional(),
  events: z.array(z.any()).optional(),
});

// Telegram Bot integration
export const telegramBotConnectSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
});

// Google Sheets integration
export const googleSheetsConnectSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

// VoIP (UTeL) integration
export const voipConnectSchema = z.object({
  apiToken: z.string().min(1, 'API token is required'),
  apiUrl: z.string().url().optional(),
});

// Generic integration update
export const integrationUpdateSchema = z.object({
  status: z.enum(['pending', 'active', 'error', 'disconnected']).optional(),
  config: z.record(z.any()).optional(),
});

export type AmoCRMConnect = z.infer<typeof amocrmConnectSchema>;
export type AmoCRMWebhook = z.infer<typeof amocrmWebhookSchema>;
export type TelegramBotConnect = z.infer<typeof telegramBotConnectSchema>;
export type GoogleSheetsConnect = z.infer<typeof googleSheetsConnectSchema>;
export type VoIPConnect = z.infer<typeof voipConnectSchema>;
export type IntegrationUpdate = z.infer<typeof integrationUpdateSchema>;
