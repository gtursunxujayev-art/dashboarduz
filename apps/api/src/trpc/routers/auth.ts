import { router, publicProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  registerWithPasswordSchema,
  loginWithPasswordSchema,
  telegramLoginSchema,
  type UserRole,
} from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { rateLimiter } from '../../services/security/rate-limiter';
import { hashPassword, verifyPassword } from '../../services/auth/password';
import { signJWT } from '../../services/auth/jwt';

export const authRouter = router({
  registerWithPassword: publicProcedure
    .input(registerWithPasswordSchema)
    .mutation(async ({ input }) => {
      const normalizedLogin = input.login.trim().toLowerCase();
      const rateLimit = await rateLimiter.isAllowed(normalizedLogin, 'auth:register-password', {
        maxRequests: 5,
        windowMs: 15 * 60 * 1000,
        keyPrefix: 'password-register',
      });
      if (!rateLimit.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Try again later.' });
      }

      if (input.password !== input.confirmPassword) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passwords do not match' });
      }

      const existingUser = await prisma.user.findFirst({
        where: { username: normalizedLogin },
      });

      if (existingUser?.passwordHash) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
      }

      const passwordHash = await hashPassword(input.password);

      let userId: string;
      let tenantId: string;
      let roles: string[];

      if (existingUser) {
        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            username: normalizedLogin,
            passwordHash,
            lastLoginAt: new Date(),
          },
        });
        userId = updatedUser.id;
        tenantId = updatedUser.tenantId;
        roles = updatedUser.roles;
      } else {
        const tenant = await prisma.tenant.create({
          data: {
            name: normalizedLogin,
            plan: 'free',
          },
        });

        const createdUser = await prisma.user.create({
          data: {
            tenantId: tenant.id,
            username: normalizedLogin,
            passwordHash,
            roles: ['Admin'],
            authProvider: 'email',
            lastLoginAt: new Date(),
          },
        });

        userId = createdUser.id;
        tenantId = tenant.id;
        roles = createdUser.roles;
      }

      const jwtPayload = {
        userId,
        tenantId,
        roles: roles.filter((role: string): role is UserRole => ['Admin', 'Manager', 'Agent', 'Finance'].includes(role)),
      };

      const token = signJWT(jwtPayload);

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'register_password',
          resource: 'auth',
          metadata: { login: normalizedLogin },
        },
      });

      return { success: true, token, user: jwtPayload };
    }),

  loginWithPassword: publicProcedure
    .input(loginWithPasswordSchema)
    .mutation(async ({ input }) => {
      const normalizedLogin = input.login.trim().toLowerCase();
      const rateLimit = await rateLimiter.isAllowed(normalizedLogin, 'auth:login-password', {
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
        keyPrefix: 'password-login',
      });
      if (!rateLimit.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again later.' });
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: normalizedLogin },
            { email: normalizedLogin },
            { phone: normalizedLogin },
          ],
        },
      });

      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }

      const passwordOk = await verifyPassword(input.password, user.passwordHash);
      if (!passwordOk) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const jwtPayload = {
        userId: updatedUser.id,
        tenantId: updatedUser.tenantId,
        roles: updatedUser.roles.filter((role: string): role is UserRole => ['Admin', 'Manager', 'Agent', 'Finance'].includes(role)),
        ...(updatedUser.phone ? { phone: updatedUser.phone } : {}),
        ...(updatedUser.email ? { email: updatedUser.email } : {}),
      };

      const token = signJWT(jwtPayload);

      await prisma.auditLog.create({
        data: {
          tenantId: updatedUser.tenantId,
          userId: updatedUser.id,
          action: 'login_password',
          resource: 'auth',
          metadata: { login: normalizedLogin },
        },
      });

      return { success: true, token, user: jwtPayload };
    }),

  // Phone OTP: Request code
  requestOtp: publicProcedure
    .input(phoneOtpRequestSchema)
    .mutation(async ({ input }) => {
      try {
        const otpLimit = await rateLimiter.isAllowed(input.phone, 'auth:request-otp', {
          maxRequests: 5,
          windowMs: 15 * 60 * 1000,
          keyPrefix: 'otp',
        });
        if (!otpLimit.allowed) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many OTP requests. Try again later.' });
        }

        const { otpService } = await import('../../services/auth/otp');
        const result = await otpService.sendOTP(input.phone);
        
        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to send OTP',
          });
        }

        return {
          success: true,
          message: 'OTP sent successfully',
          sessionId: result.messageId,
        };
      } catch (error: any) {
        console.error('[Auth] OTP request error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to send OTP',
        });
      }
    }),

  // Phone OTP: Verify code and create/login user
  verifyOtp: publicProcedure
    .input(phoneOtpVerifySchema)
    .mutation(async ({ input }) => {
      try {
        const verifyLimit = await rateLimiter.isAllowed(input.phone, 'auth:verify-otp', {
          maxRequests: 10,
          windowMs: 15 * 60 * 1000,
          keyPrefix: 'otp',
        });
        if (!verifyLimit.allowed) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many OTP attempts. Try again later.' });
        }

        // Verify OTP with provider
        const { otpService } = await import('../../services/auth/otp');

        const verification = await otpService.verifyOTP(input.phone, input.code);
        
        if (!verification.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'OTP verification service error',
          });
        }

        if (!verification.verified) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid OTP code',
          });
        }

        // Find or create user
        let user = await prisma.user.findFirst({
          where: { phone: input.phone },
        });

        let tenantId: string;
        
        if (!user) {
          // Create tenant and user for first signup
          const tenant = await prisma.tenant.create({
            data: {
              name: `Tenant ${input.phone}`,
              plan: 'free',
            },
          });

          user = await prisma.user.create({
            data: {
              tenantId: tenant.id,
              phone: input.phone,
              roles: ['Admin'],
              authProvider: 'phone',
            },
          });
          
          tenantId = tenant.id;
        } else {
          tenantId = user.tenantId;
        }

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Generate JWT token
        const jwtPayload = {
          userId: user.id,
          tenantId,
          roles: user.roles.filter((role: string): role is UserRole => ['Admin', 'Manager', 'Agent', 'Finance'].includes(role)),
          ...(user.phone ? { phone: user.phone } : {}),
        };

        const token = signJWT(jwtPayload);

        await prisma.auditLog.create({
          data: {
            tenantId,
            userId: user.id,
            action: 'login_otp',
            resource: 'auth',
            metadata: { phone: input.phone },
          },
        });

        return {
          success: true,
          user: jwtPayload,
          token,
        };
      } catch (error: any) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('[Auth] OTP verify error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'OTP verification failed',
        });
      }
    }),

  // Telegram Login: Verify and link account
  telegramLogin: publicProcedure
    .input(telegramLoginSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Telegram direct login is disabled in MVP. Use Phone OTP or Login + Password and link Telegram in integrations.',
      });
    }),

  // Get current user
  me: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const user = await prisma.user.findUnique({
      where: { id: ctx.user.userId },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return user;
  }),

  // Link additional auth method
  linkAccount: protectedProcedure
    .input(z.object({
      provider: z.enum(['phone', 'telegram']),
      providerId: z.string(),
      token: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      // Create auth link
      await prisma.userAuthLink.create({
        data: {
          userId: ctx.user.userId,
          provider: input.provider,
          providerId: input.providerId,
          verified: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.user.tenantId,
          userId: ctx.user.userId,
          action: 'link_account',
          resource: 'auth',
          metadata: { provider: input.provider, providerId: input.providerId },
        },
      });

      return { success: true };
    }),
});
