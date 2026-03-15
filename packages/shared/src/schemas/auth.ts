import { z } from 'zod';

// Phone OTP schemas
export const phoneOtpRequestSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
});

export const phoneOtpVerifySchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  code: z.string().length(6, 'OTP code must be 6 digits'),
});

// Password auth schemas
export const registerWithPasswordSchema = z.object({
  login: z
    .string()
    .min(3, 'Login must be at least 3 characters')
    .max(50, 'Login must be at most 50 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Login may contain only letters, numbers, dots, underscores, and hyphens'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
});

export const loginWithPasswordSchema = z.object({
  login: z.string().min(3, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
});

// Telegram Login schemas
export const telegramLoginSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().url().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

// Account linking
export const linkAccountSchema = z.object({
  provider: z.enum(['phone', 'telegram']),
  providerId: z.string(),
  token: z.string().optional(),
});

// JWT payload
export const jwtPayloadSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  roles: z.array(z.enum(['Admin', 'Manager', 'Agent', 'Finance'])),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export type PhoneOtpRequest = z.infer<typeof phoneOtpRequestSchema>;
export type PhoneOtpVerify = z.infer<typeof phoneOtpVerifySchema>;
export type RegisterWithPassword = z.infer<typeof registerWithPasswordSchema>;
export type LoginWithPassword = z.infer<typeof loginWithPasswordSchema>;
export type TelegramLogin = z.infer<typeof telegramLoginSchema>;
export type LinkAccount = z.infer<typeof linkAccountSchema>;
export type JWTPayload = z.infer<typeof jwtPayloadSchema>;
