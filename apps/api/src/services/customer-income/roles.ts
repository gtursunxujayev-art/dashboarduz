import type { DbClient } from '@dashboarduz/db';
import { isAgentOnly } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { ADJUSTMENT_TYPE_REFUND, ADJUSTMENT_TYPE_TARIFF_CHANGE, APPROVER_ROLES_REFUND, APPROVER_ROLES_TARIFF_CHANGE, SALES_MANAGER_ROLE_TOKENS } from './constants';

export function isAdminUser(roles: string[]): boolean {
  return roles.includes('Admin');
}

export function hasSalesManagerRole(roles: unknown): boolean {
  if (Array.isArray(roles)) {
    return roles.some((role) => SALES_MANAGER_ROLE_TOKENS.has(String(role).trim().toLowerCase()));
  }
  if (typeof roles === 'string') {
    const normalized = roles.trim().toLowerCase();

    if (SALES_MANAGER_ROLE_TOKENS.has(normalized)) {
      return true;
    }

    return normalized
      .split(/[,\s|;]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .some((token) => SALES_MANAGER_ROLE_TOKENS.has(token));
  }

  return false;
}

export function shouldSelfScopeManagerActions(roles: string[]): boolean {
  return isAgentOnly(roles);
}

function isPrivilegedAdjustmentViewer(roles: string[]): boolean {
  return roles.some((role) => (
    role === 'Admin'
    || role === 'Manager'
    || role === 'Finance'
    || role === 'Organizator'
    || role === 'Organizer'
    || role === 'Tashkiliy'
  ));
}

export function canApproveRefundRequest(roles: string[]): boolean {
  return roles.some((role) => APPROVER_ROLES_REFUND.has(role));
}

const REFUND_CARD_NUMBER_VIEWER_ROLES = new Set(['Admin', 'Finance']);

/** Only Admin and Finance may see the stored refund card number in API responses (it is kept as entered). */
export function canViewRefundCardNumber(roles: string[]): boolean {
  return roles.some((role) => REFUND_CARD_NUMBER_VIEWER_ROLES.has(role));
}

export function canApproveTariffChangeRequest(roles: string[]): boolean {
  return roles.some((role) => APPROVER_ROLES_TARIFF_CHANGE.has(role));
}

export function getAdjustmentRoleScope(rolesInput: string[]) {
  const roles = rolesInput.map((role) => String(role));
  const isAdmin = roles.includes('Admin');
  const hasFinance = roles.includes('Finance');
  const hasManagerLike = roles.includes('Manager')
    || roles.includes('TeamLeader')
    || roles.includes('Organizator')
    || roles.includes('Organizer')
    || roles.includes('Tashkiliy');
  const canSeeAll = isPrivilegedAdjustmentViewer(roles);

  const typeGuard: typeof ADJUSTMENT_TYPE_REFUND | typeof ADJUSTMENT_TYPE_TARIFF_CHANGE | null = canSeeAll && !isAdmin
    ? (
        hasFinance && !hasManagerLike
          ? ADJUSTMENT_TYPE_REFUND
          : (!hasFinance && hasManagerLike ? ADJUSTMENT_TYPE_TARIFF_CHANGE : null)
      )
    : null;

  return {
    roles,
    isAdmin,
    hasFinance,
    hasManagerLike,
    canSeeAll,
    typeGuard,
  };
}

export function canSelectInactiveManagerForIncome(roles: string[]): boolean {
  return roles.some((role) => role === 'Admin' || role === 'Finance' || role === 'TeamLeader');
}

export async function assertManagerBelongsToTenantWithOptions(params: {
  tenantId: string;
  managerUserId: string;
  includeInactive: boolean;
  db: DbClient;
}) {
  const { db } = params;

  const manager = await db.user.findFirst({
    where: {
      id: params.managerUserId,
      tenantId: params.tenantId,
      ...(params.includeInactive ? {} : { isActive: true }),
    },
    select: {
      id: true,
      roles: true,
    },
  });

  if (!manager || !hasSalesManagerRole(manager.roles)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sales manager is not available.' });
  }
}
