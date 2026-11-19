// Calls come from amoCRM only: the call-note import (integrations/amocrm-call-sync.ts) writes them to the
// `calls` table with provider "amocrm" and sets `managerUserId` from the note's amoCRM responsible user.
// Every report attributes a call to a manager by `managerUserId` and nothing else. Older rows with another
// provider (e.g. "utel", from the removed VoIP webhook) are kept as history and never counted.

/** The `Call.provider` value every call count filters on. */
export const AMOCRM_CALL_PROVIDER = 'amocrm';

/** A counted call lasting at least this many seconds is a long call ("4 daq+" on the dashboard seller table). */
export const LONG_CALL_MIN_SECONDS = 240;

/** `where` for the counted calls of a tenant, optionally limited to some managers. */
export function countedCallsWhere(tenantId: string, managerUserIds?: readonly string[]): {
  tenantId: string;
  provider: string;
  managerUserId?: { in: string[] };
} {
  return {
    tenantId,
    provider: AMOCRM_CALL_PROVIDER,
    ...(managerUserIds ? { managerUserId: { in: [...managerUserIds] } } : {}),
  };
}
