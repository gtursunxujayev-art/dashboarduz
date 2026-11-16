import { systemPrisma } from '@dashboarduz/db';
import { normalizeDigits } from '@dashboarduz/shared';

import { asObject } from '../../lib/object';

import { buildNormalizedFullName, type FaceIdParsedEvent } from './faceid-payload';

type FaceIdMatchStep = 'phone' | 'external_id' | 'name';

type FaceIdUnmatchedReason =
  | 'phone_not_found'
  | 'external_id_not_mapped'
  | 'name_not_unique'
  | 'name_not_found'
  | 'branch_filtered';

type FaceIdMatchResult = {
  userId: string | null;
  matchStepTried: FaceIdMatchStep;
  matchReason: FaceIdUnmatchedReason | null;
  rawUser: {
    id: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  };
};

function parseExternalUserMap(config: unknown): Record<string, string> {
  const mapHolder = asObject(config)?.userExternalMap;

  if (!mapHolder || typeof mapHolder !== 'object' || Array.isArray(mapHolder)) {
    return {};
  }
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(mapHolder)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();

    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    result[normalizedKey] = normalizedValue;
  }

  return result;
}

export function parseBranchWhitelist(config: unknown): Set<string> {
  const raw = asObject(config)?.branchWhitelist;

  if (!Array.isArray(raw)) {
    return new Set();
  }

  const normalized = raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return new Set(normalized);
}

export function parseUnmatchedUserPolicy(config: unknown): 'store' | 'ignore' {
  const raw = asObject(config)?.unmatchedUserPolicy;
  const normalized = String(raw || '').trim().toLowerCase();

  return normalized === 'ignore' ? 'ignore' : 'store';
}

export async function resolveMatchedUserId(params: {
  tenantId: string;
  parsed: FaceIdParsedEvent;
  integrationConfig: unknown;
}): Promise<FaceIdMatchResult> {
  const rawUser = {
    id: params.parsed.externalUserId || null,
    firstName: params.parsed.firstName || null,
    lastName: params.parsed.lastName || null,
    phone: params.parsed.externalPhone || null,
  };

  // 1) Phone match first.
  const normalizedExternalPhone = normalizeDigits(params.parsed.externalPhone);

  if (normalizedExternalPhone) {
    const phoneCandidates = await systemPrisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        phone: { not: null },
      },
      select: {
        id: true,
        phone: true,
      },
      take: 5000,
    });

    const matchedByPhone = phoneCandidates.filter(
      (candidate) => normalizeDigits(candidate.phone) === normalizedExternalPhone,
    );

    if (matchedByPhone.length === 1) {
      return {
        userId: matchedByPhone[0]?.id || null,
        matchStepTried: 'phone',
        matchReason: null,
        rawUser,
      };
    }
  }

  // 2) External Face user id fallback.
  const userExternalMap = parseExternalUserMap(params.integrationConfig);

  if (params.parsed.externalUserId) {
    const mappedUserId = userExternalMap[params.parsed.externalUserId];

    if (mappedUserId) {
      const mappedUser = await systemPrisma.user.findFirst({
        where: {
          id: mappedUserId,
          tenantId: params.tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (mappedUser?.id) {
        return {
          userId: mappedUser.id,
          matchStepTried: 'external_id',
          matchReason: null,
          rawUser,
        };
      }
    }
  }

  // 3) Strict unique full-name fallback.
  const incomingNormalizedName = buildNormalizedFullName(params.parsed.firstName, params.parsed.lastName);

  if (incomingNormalizedName) {
    const nameCandidates = await systemPrisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        name: { not: null },
      },
      select: {
        id: true,
        name: true,
      },
      take: 5000,
    });

    const matchedByName = nameCandidates.filter(
      (candidate) => buildNormalizedFullName(candidate.name, null) === incomingNormalizedName,
    );

    if (matchedByName.length === 1) {
      return {
        userId: matchedByName[0]?.id || null,
        matchStepTried: 'name',
        matchReason: null,
        rawUser,
      };
    }

    if (matchedByName.length > 1) {
      return {
        userId: null,
        matchStepTried: 'name',
        matchReason: 'name_not_unique',
        rawUser,
      };
    }

    return {
      userId: null,
      matchStepTried: 'name',
      matchReason: 'name_not_found',
      rawUser,
    };
  }

  return {
    userId: null,
    matchStepTried: params.parsed.externalUserId ? 'external_id' : 'phone',
    matchReason: params.parsed.externalUserId ? 'external_id_not_mapped' : 'phone_not_found',
    rawUser,
  };
}
