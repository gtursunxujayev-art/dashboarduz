import { formatSomAmount } from '@dashboarduz/shared';

import type { buildMetrics, SellerSalesMetrics } from './metrics';

type SellerReportSeller = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type SellerReportPayload = {
  seller: SellerReportSeller;
  metrics: ReturnType<typeof buildMetrics> & SellerSalesMetrics;
  rangeStart: Date;
  rangeEnd: Date;
};

export function buildSellerReportPdf(params: SellerReportPayload): Buffer {
  const lines = [
    `${params.seller.name} — agent report`,
    `Period: ${params.rangeStart.toISOString()} — ${params.rangeEnd.toISOString()}`,
    '',
    `Sales count: ${params.metrics.newSalesCount}`,
    `Agreement amount: ${formatSomAmount(params.metrics.newSalesAgreementAmount)}`,
    `Income amount: ${formatSomAmount(params.metrics.incomeAmount)}`,
    `Average sales: ${params.metrics.averageSalesCount.toFixed(2)}`,
    '',
    `Online: ${params.metrics.onlineSalesCount} | Agreement ${formatSomAmount(params.metrics.onlineSalesAgreementAmount)} | Income ${formatSomAmount(params.metrics.onlineSalesIncomeAmount)}`,
    `Offline: ${params.metrics.offlineSalesCount} | Agreement ${formatSomAmount(params.metrics.offlineSalesAgreementAmount)} | Income ${formatSomAmount(params.metrics.offlineSalesIncomeAmount)}`,
    `Intensive: ${params.metrics.intensiveSalesCount} | Agreement ${formatSomAmount(params.metrics.intensiveSalesAgreementAmount)} | Income ${formatSomAmount(params.metrics.intensiveSalesIncomeAmount)}`,
    '',
    `Calls: ${params.metrics.totalCalls}`,
    `Call duration: ${params.metrics.totalCallDuration} seconds`,
    `Follow-ups done: ${params.metrics.followUpCount}`,
    `Notes: ${params.metrics.noteCount}`,
    `CRM changes: ${params.metrics.stageChangeCount}`,
    `Today's follow-ups: ${params.metrics.todayFollowUpCount}`,
    `Overdue follow-ups: ${params.metrics.overdueFollowUpCount}`,
  ];

  const content = lines
    .map((line, index) => {
      const escaped = line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[^\x20-\x7E]/g, '?');

      return `BT /F1 12 Tf 50 ${780 - index * 20} Td (${escaped}) Tj ET`;
    })
    .join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}
