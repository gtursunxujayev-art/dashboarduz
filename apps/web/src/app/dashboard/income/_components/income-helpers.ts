import type { IncomeType } from '@dashboarduz/shared';

export type IncomeTypeChoice = '' | IncomeType;

export type FieldErrors = Record<string, string>;

export type CustomerOption = {
  id: string;
  customerNumber: string;
  name: string;
  telegramUsername?: string | null;
  responsibleManagerUserId?: string | null;
  responsibleManagerLabel?: string | null;
};

export type EditIncomeForm = {
  incomeId: string;
  type: IncomeType;
  entryDate: string;
  managerUserId: string;
  paymentInput: string;
  deadline: string;
  courseId: string;
  tariffId: string;
  subTariffId: string;
  coursePriceInput: string;
};

type SubTariffOptionLike = {
  id?: string | null;
  name?: string | null;
};

export const TELEGRAM_USERNAME_PATTERN = /^@?[A-Za-z0-9_]+$/;

export function getDisplayedRemainingDebtForIncomeRow(income: any): number {
  if (!income || typeof income !== 'object') {
    return 0;
  }

  // Each row shows the debt left right after that payment. For a sale row that is agreement minus its first payment;
  // the agreement uses the same order as the API (coursePriceAmount, then debtAmount, then the payment).
  if (income.type === 'new_sale') {
    const agreementAmount = Number(income.coursePriceAmount ?? income.debtAmount ?? income.paymentAmount ?? 0);
    const firstPaymentAmount = Number(income.paymentAmount ?? 0);
    return Math.max(agreementAmount - firstPaymentAmount, 0);
  }

  return Math.max(Number(income.remainingDebtAmount ?? 0), 0);
}

export function formatDateForInput(value: string | Date | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export function normalizeTextToken(value: unknown): string {
  return String(value ?? '').trim();
}

export function resolveCanonicalSubTariffId(
  selectedValue: string,
  options: SubTariffOptionLike[],
): string {
  const normalizedSelectedValue = normalizeTextToken(selectedValue);
  if (!normalizedSelectedValue) {
    return '';
  }

  const matchById = options.find(
    (option) => normalizeTextToken(option.id) === normalizedSelectedValue,
  );
  if (matchById?.id) {
    return normalizeTextToken(matchById.id);
  }

  const matchByName = options.find(
    (option) => normalizeTextToken(option.name) === normalizedSelectedValue,
  );
  if (matchByName?.id) {
    return normalizeTextToken(matchByName.id);
  }

  return '';
}

export function getSubTariffOptionValue(option: SubTariffOptionLike): string {
  const id = normalizeTextToken(option.id);
  if (id) {
    return id;
  }
  return normalizeTextToken(option.name);
}

export function getTelegramDispatchWarning(dispatch: any): string | null {
  if (!dispatch || typeof dispatch !== 'object') {
    return null;
  }

  const reason = String(dispatch.reason || '');
  if (reason === 'skipped_by_admin') {
    return null;
  }

  if (dispatch.delivered) {
    return null;
  }

  if (reason === 'course_not_eligible') {
    return "Telegram guruhiga yuborilmadi: kurs kategoriyasi bo'yicha mos guruh topilmadi (kurs/kategoriya sozlamasini tekshiring).";
  }

  if (reason === 'groups_missing') {
    return "Telegram guruhiga yuborilmadi: OFLINE_GROUP_ID (yoki OFFLINE_GROUP_ID) sozlanmagan.";
  }

  if (reason === 'bot_token_missing') {
    return "Telegram guruhiga yuborilmadi: bot token topilmadi (integratsiya yoki TELEGRAM_BOT_TOKEN ni tekshiring).";
  }

  const firstError = Array.isArray(dispatch.errors) && dispatch.errors.length > 0
    ? String(dispatch.errors[0])
    : null;
  if (firstError) {
    return `Telegram guruhiga yuborilmadi: ${firstError}`;
  }

  return "Telegram guruhiga yuborilmadi. API loglarini tekshiring.";
}
