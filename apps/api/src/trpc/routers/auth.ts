import { systemPrisma } from '@dashboarduz/db';
import {
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  registerWithPasswordSchema,
  loginWithPasswordSchema,
  changeCredentialsSchema,
  telegramLoginSchema,
  USER_ROLES,
  type UserRole,
} from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { messagePropertyOfError } from '../../lib/errors';
import { logger, maskPhone } from '../../lib/logger';
import { isUniqueViolation } from '../../lib/prisma-errors';
import { signJWT } from '../../services/auth/jwt';
import { hashPassword, verifyPassword } from '../../services/auth/password';
import { rateLimiter } from '../../services/security/rate-limiter';
import { router, publicProcedure, protectedProcedure } from '../trpc';

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

      // Logins are unique across all tenants (users.username), so this lookup deliberately uses the unscoped
      // systemPrisma: there is no tenant yet, and once RLS is enforced a scoped client would miss other tenants.
      const existingUser = await systemPrisma.user.findFirst({
        where: { username: normalizedLogin },
        select: {
          id: true,
          tenantId: true,
          roles: true,
          passwordHash: true,
        },
      });

      if (existingUser?.passwordHash) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
      }

      const passwordHash = await hashPassword(input.password);

      let userId: string;
      let tenantId: string;
      let roles: string[];

      if (existingUser) {
        const updatedUser = await systemPrisma.user.update({
          where: { id: existingUser.id },
          data: {
            username: normalizedLogin,
            passwordHash,
            lastLoginAt: new Date(),
          },
          select: {
            id: true,
            tenantId: true,
            roles: true,
          },
        });

        userId = updatedUser.id;
        tenantId = updatedUser.tenantId;
        roles = updatedUser.roles;
      } else {
        // Tenant and its first user are created together: a failure (e.g. the login taken by a concurrent
        // registration, users.username is unique) leaves no tenant without a user behind.
        const createdUser = await systemPrisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              name: normalizedLogin,
              plan: 'free',
            },
          });

          return tx.user.create({
            data: {
              tenantId: tenant.id,
              username: normalizedLogin,
              passwordHash,
              roles: ['Admin'],
              authProvider: 'email',
              lastLoginAt: new Date(),
            },
            select: {
              id: true,
              tenantId: true,
              roles: true,
            },
          });
        }).catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
          }
          throw error;
        });

        userId = createdUser.id;
        tenantId = createdUser.tenantId;
        roles = createdUser.roles;
      }

      const jwtPayload = {
        userId,
        tenantId,
        roles: roles.filter((role: string): role is UserRole => (USER_ROLES as readonly string[]).includes(role)),
      };

      const token = signJWT(jwtPayload);

      await systemPrisma.auditLog.create({
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

      const user = await systemPrisma.user.findFirst({
        where: {
          OR: [
            { username: normalizedLogin },
            { email: normalizedLogin },
            { phone: normalizedLogin },
          ],
        },
        select: {
          id: true,
          tenantId: true,
          roles: true,
          phone: true,
          email: true,
          passwordHash: true,
          isActive: true,
        },
      });

      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }
      if (!user.isActive) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User is deactivated' });
      }

      const passwordOk = await verifyPassword(input.password, user.passwordHash);

      if (!passwordOk) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }

      const updatedUser = await systemPrisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        select: {
          id: true,
          tenantId: true,
          roles: true,
          phone: true,
          email: true,
        },
      });

      const jwtPayload = {
        userId: updatedUser.id,
        tenantId: updatedUser.tenantId,
        roles: updatedUser.roles.filter((role: string): role is UserRole => (USER_ROLES as readonly string[]).includes(role)),
        ...(updatedUser.phone ? { phone: updatedUser.phone } : {}),
        ...(updatedUser.email ? { email: updatedUser.email } : {}),
      };

      const token = signJWT(jwtPayload);

      await systemPrisma.auditLog.create({
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
      } catch (error: unknown) {
        // A deliberate answer (rate limit, send failure) goes out as is, not as a 500.
        if (error instanceof TRPCError) throw error;
        logger.error({ err: error, phone: maskPhone(input?.phone) }, '[Auth] OTP request error');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: messagePropertyOfError(error) || 'Failed to send OTP',
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
        let user = await systemPrisma.user.findFirst({
          where: { phone: input.phone },
          select: {
            id: true,
            tenantId: true,
            roles: true,
            phone: true,
            isActive: true,
          },
        });

        let tenantId: string;
        
        if (!user) {
          // Create tenant and user for first signup
          // Tenant and its first user are created together, so a failed signup leaves no empty tenant.
          user = await systemPrisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
              data: {
                name: `Tenant ${input.phone}`,
                plan: 'free',
              },
            });

            return tx.user.create({
              data: {
                tenantId: tenant.id,
                phone: input.phone,
                roles: ['Admin'],
                authProvider: 'phone',
              },
              select: {
                id: true,
                tenantId: true,
                roles: true,
                phone: true,
                isActive: true,
              },
            });
          });

          tenantId = user.tenantId;
        } else {
          tenantId = user.tenantId;
          if (!user.isActive) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'User is deactivated',
            });
          }
        }

        if (!user) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to resolve user for OTP login',
          });
        }

        // Update last login
        await systemPrisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
          select: { id: true },
        });

        // Generate JWT token
        const jwtPayload = {
          userId: user.id,
          tenantId,
          roles: user.roles.filter((role: string): role is UserRole => (USER_ROLES as readonly string[]).includes(role)),
          ...(user.phone ? { phone: user.phone } : {}),
        };

        const token = signJWT(jwtPayload);

        await systemPrisma.auditLog.create({
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
      } catch (error: unknown) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        logger.error({ err: error, phone: maskPhone(input?.phone) }, '[Auth] OTP verify error');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: messagePropertyOfError(error) || 'OTP verification failed',
        });
      }
    }),

  // Telegram Login: Verify and link account
  telegramLogin: publicProcedure
    .input(telegramLoginSchema)
    .mutation(() => {
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

    const user = await ctx.db.user.findUnique({
      where: { id: ctx.user.userId },
      select: {
        id: true,
        tenantId: true,
        username: true,
        email: true,
        phone: true,
        name: true,
        roles: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        authProvider: true,
        tenant: true,
      },
    });

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return user;
  }),

  changeCredentials: protectedProcedure
    .input(changeCredentialsSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.user.userId },
        select: {
          id: true,
          tenantId: true,
          username: true,
          passwordHash: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      if (!user.passwordHash) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Password login is not configured for this user.' });
      }

      const passwordOk = await verifyPassword(input.currentPassword, user.passwordHash);

      if (!passwordOk) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect.' });
      }

      const nextLogin = input.newLogin?.trim().toLowerCase();

      if (nextLogin && nextLogin !== user.username) {
        // users.username is unique across ALL tenants, so this check must see every tenant. It deliberately uses
        // the unscoped systemPrisma: with RLS enforced, ctx.db would only see this tenant and miss a clash.
        const duplicate = await systemPrisma.user.findFirst({
          where: {
            username: nextLogin,
            NOT: { id: user.id },
          },
          select: { id: true },
        });

        if (duplicate) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Login already in use.' });
        }
      }

      const nextPasswordHash = input.newPassword ? await hashPassword(input.newPassword) : null;

      if (!nextLogin && !nextPasswordHash) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No changes provided.' });
      }

      const updated = await ctx.db.user.update({
        where: { id: user.id },
        data: {
          ...(nextLogin ? { username: nextLogin } : {}),
          ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
        },
        select: {
          id: true,
          username: true,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: 'self_credentials_update',
          resource: 'auth',
          resourceId: user.id,
          metadata: {
            loginUpdated: Boolean(nextLogin),
            passwordUpdated: Boolean(nextPasswordHash),
          },
        },
      });

      return {
        success: true,
        user: updated,
      };
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
      await ctx.db.userAuthLink.create({
        data: {
          userId: ctx.user.userId,
          provider: input.provider,
          providerId: input.providerId,
          verified: true,
        },
      });

      await ctx.db.auditLog.create({
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
