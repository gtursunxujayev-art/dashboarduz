import type { AmountFormatOptions, ManagerGroup } from '@dashboarduz/shared';

export const CURRENCY_FORMAT: AmountFormatOptions = { locale: 'en-US', unit: 'UZS', round: true };

/** A call of at least this many seconds counts in the per-manager "4+ daq" column. */
export const LONG_CALL_MIN_SECONDS = 4 * 60;

type ReportKind ='daily' | 'weekly' | 'monthly';

export type ReportWindow = {
  kind: ReportKind;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  periodKey: string;
};

export type ManualReportKind = 'today' | 'weekly' | 'monthly';

export type ReportManagerRow = {
  group: ManagerGroup;
  name: string;
  leads: number;
  qualified: number;
  nonQualified: number;
  sales: number;
  conversion: number;
  agreementAmount: number;
  incomeAmount: number;
  callDurationSeconds: number;
  callCount: number;
  longCallCount: number;
};

export type ReportMetrics = {
  newLeads: number;
  qualifiedLeads: number;
  nonQualifiedLeads: number;
  qualifiedShare: number;
  nonQualifiedShare: number;
  newSalesCount: number;
  conversionPercent: number;
  agreementTotal: number;
  incomeTotal: number;
  newSalesIncomeTotal: number;
  debtRepaymentIncomeTotal: number;
  onlineSalesCount: number;
  onlineAgreementTotal: number;
  offlineSalesCount: number;
  offlineAgreementTotal: number;
  intensiveSalesCount: number;
  intensiveAgreementTotal: number;
  totalCalls: number;
  talkDurationSeconds: number;
  reasonBreakdown: Array<{ label: string; value: number }>;
  sourceBreakdown: Array<{ label: string; value: number }>;
  selectedCourseRows: Array<{
    courseId: string;
    courseName: string;
    salesCount: number;
    tariffBreakdown: Array<{ label: string; value: number }>;
  }>;
  managerRows: ReportManagerRow[];
};

export type TelegramIntegrationWithTenant = {
  id: string;
  tenantId: string;
  tokensEncrypted: string | null;
  config: unknown;
  tenant: {
    name: string | null;
    settings: unknown;
  };
};
