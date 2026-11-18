/**
 * Per-manager rows of the Telegram report: leads (by amoCRM manager id), sales and calls joined onto the
 * tenant's active users. Pure functions.
 */
import { type ManagerGroup } from '@dashboarduz/shared';

import { roundPositivePercentage } from '../../../lib/number';

import { classifyManagerGroup, compareManagerRows } from './format';
import type { ManagerLeadCounts } from './metrics-leads';
import type { ManagerSalesStats } from './metrics-sales';
import { LONG_CALL_MIN_SECONDS, type ReportManagerRow } from './types';

export type ReportUser = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
  amocrmResponsibleUserId: string | null;
};

type ReportUserRef = { id: string; name: string; group: ManagerGroup | null };

export type ReportUserIndex = {
  usersById: Map<string, ReportUserRef>;
  usersByAmoId: Map<string, ReportUserRef>;
};

export type ManagerCallCounts = { calls: number; longCalls: number };

export type ManagerCallTally = {
  durationByUserId: Map<string, number>;
  countsByUserId: Map<string, ManagerCallCounts>;
};

type ManagerRowDraft = Omit<ReportManagerRow, 'group' | 'conversion' | 'callDurationSeconds' | 'callCount' | 'longCallCount'> & {
  userId: string;
  group: ManagerGroup | null;
};

/** Users by id and by amoCRM manager id, named by name, else username, else id (trimmed). */
export function indexReportUsers(users: ReportUser[]): ReportUserIndex {
  const usersById = new Map<string, ReportUserRef>();
  const usersByAmoId = new Map<string, ReportUserRef>();

  for (const user of users) {
    const ref = { id: user.id, name: (user.name || user.username || user.id).trim(), group: classifyManagerGroup(user.roles) };

    usersById.set(user.id, ref);
    if (user.amocrmResponsibleUserId) {
      usersByAmoId.set(String(user.amocrmResponsibleUserId), ref);
    }
  }

  return { usersById, usersByAmoId };
}

/** Talk time, call count and long calls (at least LONG_CALL_MIN_SECONDS) per manager; calls without a manager are skipped. */
export function tallyManagerCalls(calls: Array<{ managerUserId: string | null; duration: number | null }>): ManagerCallTally {
  const durationByUserId = new Map<string, number>();
  const countsByUserId = new Map<string, ManagerCallCounts>();

  for (const call of calls) {
    const managerUserId = call.managerUserId;

    if (!managerUserId) {
      continue;
    }
    const callDuration = Math.max(0, Number(call.duration || 0));
    const counts = countsByUserId.get(managerUserId) || { calls: 0, longCalls: 0 };

    durationByUserId.set(managerUserId, (durationByUserId.get(managerUserId) || 0) + callDuration);
    counts.calls += 1;
    if (callDuration >= LONG_CALL_MIN_SECONDS) {
      counts.longCalls += 1;
    }
    countsByUserId.set(managerUserId, counts);
  }

  return { durationByUserId, countsByUserId };
}

function emptyRowDraft(userId: string, group: ManagerGroup | null, name: string): ManagerRowDraft {
  return { userId, group, name, leads: 0, qualified: 0, nonQualified: 0, sales: 0, agreementAmount: 0, incomeAmount: 0 };
}

/**
 * Report rows of the managers in an online / offline group who had leads, sales or calls, best first.
 * Leads count only for amoCRM ids mapped to a user; sales and calls are keyed by user id.
 */
export function buildManagerRows(input: {
  users: ReportUserIndex;
  managerLeadsByAmoId: Map<string, ManagerLeadCounts>;
  managerSalesByUserId: Map<string, ManagerSalesStats>;
  calls: ManagerCallTally;
  corporateDurationByUserId: Map<string, number>;
}): ReportManagerRow[] {
  const { usersById, usersByAmoId } = input.users;
  const drafts = new Map<string, ManagerRowDraft>();

  for (const [amoId, leadStats] of input.managerLeadsByAmoId) {
    const user = usersByAmoId.get(amoId);

    if (!user) {
      continue;
    }
    const draft = drafts.get(user.id) || emptyRowDraft(user.id, user.group, user.name);

    draft.leads += leadStats.leads;
    draft.qualified += leadStats.qualified;
    draft.nonQualified += leadStats.nonQualified;
    drafts.set(user.id, draft);
  }

  for (const [userId, salesStats] of input.managerSalesByUserId) {
    const user = usersById.get(userId);
    const draft = drafts.get(userId) || emptyRowDraft(userId, user?.group || null, user?.name || userId);

    draft.sales += salesStats.sales;
    draft.agreementAmount += salesStats.agreementAmount;
    draft.incomeAmount += salesStats.incomeAmount;
    drafts.set(userId, draft);
  }

  // Managers who only made calls (no leads or sales) still get a row.
  for (const userId of input.calls.countsByUserId.keys()) {
    const user = usersById.get(userId);

    if (user && !drafts.has(userId)) {
      drafts.set(userId, emptyRowDraft(userId, user.group, user.name));
    }
  }

  return Array.from(drafts.values())
    .map((draft) => ({
      group: draft.group,
      name: draft.name,
      leads: draft.leads,
      qualified: draft.qualified,
      nonQualified: draft.nonQualified,
      sales: draft.sales,
      conversion: draft.leads > 0 ? roundPositivePercentage((draft.sales / draft.leads) * 100) : 0,
      agreementAmount: draft.agreementAmount,
      incomeAmount: draft.incomeAmount,
      callDurationSeconds: (input.calls.durationByUserId.get(draft.userId) || 0) + (input.corporateDurationByUserId.get(draft.userId) || 0),
      callCount: input.calls.countsByUserId.get(draft.userId)?.calls || 0,
      longCallCount: input.calls.countsByUserId.get(draft.userId)?.longCalls || 0,
    }))
    .filter((row): row is ReportManagerRow => (
      row.group !== null
      && (row.leads > 0 || row.sales > 0 || row.agreementAmount > 0 || row.incomeAmount > 0 || row.callCount > 0)
    ))
    .sort(compareManagerRows);
}
