import { formatAmount, toTashkentDateKey } from '@dashboarduz/shared';

import { formatClockHoursMinutes, formatCompactCurrency, formatDuration, formatLocalDateTime, formatSelectedCourseLine, getBreakdownLayout, groupManagerRows } from './format';
import { PdfCanvas, type PdfColor } from './pdf-canvas';
import { CURRENCY_FORMAT, type ReportManagerRow, type ReportMetrics } from './types';

export function createStyledReportPdf(params: {
  tenantName: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  metrics: ReportMetrics;
}): Buffer {
  const c = new PdfCanvas();
  const dark: PdfColor = [138 / 255, 21 / 255, 56 / 255];
  const lightBorder: PdfColor = [0.72, 0.78, 0.86];
  const cardBg: PdfColor = [0.96, 0.97, 0.99];
  const textDark: PdfColor = [0.11, 0.16, 0.24];
  const accent: PdfColor = [0.12, 0.4, 0.95];
  const white: PdfColor = [1, 1, 1];
  const headerDateRange = `${toTashkentDateKey(params.periodStart)} - ${toTashkentDateKey(params.periodEnd)}`;
  const fontDelta = 0;
  const size = (base: number): number => Math.max(6, base + fontDelta);
  const pageContentBottom = 800;
  const pageFooterTop = 816;
  const contentLeft = 44;
  const contentWidth = 503;

  const drawFooter = () => {
    c.text(pageFooterTop, contentLeft, 'Dashboarduz tomonidan yaratildi', {
      size: size(8),
      color: [0.5, 0.56, 0.66],
    });
  };

  c.rect(16, 24, 547, 62, { fill: dark });
  c.text(26, 44, params.tenantName, {
    font: 'F2',
    size: c.fitSize(params.tenantName, contentWidth, { size: size(20), minSize: 14, font: 'F2' }),
    color: white,
    maxWidth: contentWidth,
  });
  c.text(56, 44, params.title, { font: 'F1', size: size(12), color: [0.76, 0.82, 0.92], maxWidth: contentWidth });
  c.text(92, 44, `Davr: ${toTashkentDateKey(params.periodStart)} - ${toTashkentDateKey(params.periodEnd)}`, { size: size(10), color: textDark });
  c.text(106, 44, `Tayyorlangan: ${formatLocalDateTime(params.generatedAt)}`, { size: size(10), color: textDark });
  drawFooter();

  const cardTop = 130;
  const cardHeight = 54;
  const cardRowStep = cardHeight + 14;
  const cardLeft = (col: number) => 44 + col * 172;
  const cardRowTop = (row: number) => cardTop + row * cardRowStep;
  const cardTextWidth = 140;

  const drawStandardCard = (row: number, col: number, title: string, value: string) => {
    const top = cardRowTop(row);
    const left = cardLeft(col);

    c.rect(top, left, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
    c.text(top + 10, left + 10, title, { size: size(9), color: [0.4, 0.46, 0.56], maxWidth: cardTextWidth });
    c.text(top + 27, left + 10, value, {
      font: 'F2',
      size: c.fitSize(value, cardTextWidth, { size: size(14), minSize: 9, font: 'F2' }),
      color: accent,
      maxWidth: cardTextWidth,
    });
  };

  drawStandardCard(0, 0, 'Kelishuv summasi', formatAmount(params.metrics.agreementTotal, CURRENCY_FORMAT));
  drawStandardCard(0, 2, 'Online kelishuv summasi', formatAmount(params.metrics.onlineAgreementTotal, CURRENCY_FORMAT));
  drawStandardCard(1, 0, 'Offline kelishuv summasi', formatAmount(params.metrics.offlineAgreementTotal, CURRENCY_FORMAT));
  drawStandardCard(1, 2, 'Sifatli lidlar', `${params.metrics.qualifiedLeads} (${params.metrics.qualifiedShare.toFixed(1)}%)`);

  // Tushum card with new-sale vs debt-repayment split.
  const incomeTop = cardRowTop(0);
  const incomeLeft = cardLeft(1);

  c.rect(incomeTop, incomeLeft, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  // Label 6-14, amount 15-27, split lines 30-37.5 and 41-48.5: no overlap within the 54-point card.
  const incomeValue = formatAmount(params.metrics.incomeTotal, CURRENCY_FORMAT);

  c.text(incomeTop + 6, incomeLeft + 10, 'Tushum', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(incomeTop + 15, incomeLeft + 10, incomeValue, {
    font: 'F2',
    size: c.fitSize(incomeValue, cardTextWidth, { size: size(12), minSize: 9, font: 'F2' }),
    color: accent,
    maxWidth: cardTextWidth,
  });
  c.text(incomeTop + 30, incomeLeft + 10, `Yangi sotuv: ${formatAmount(params.metrics.newSalesIncomeTotal, CURRENCY_FORMAT)}`, {
    size: size(7.5),
    color: textDark,
    maxWidth: cardTextWidth,
  });
  c.text(incomeTop + 41, incomeLeft + 10, `Qarz to'lovi: ${formatAmount(params.metrics.debtRepaymentIncomeTotal, CURRENCY_FORMAT)}`, {
    size: size(7.5),
    color: textDark,
    maxWidth: cardTextWidth,
  });

  // Split half cards in the middle slot of row 2 (by width).
  const splitTop = cardRowTop(1);
  const splitLeft = cardLeft(1);
  const splitGap = 4;
  const splitWidth = Math.floor((160 - splitGap) / 2);

  c.rect(splitTop, splitLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 9, splitLeft + 8, 'Yangi lidlar', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 27, splitLeft + 8, String(params.metrics.newLeads), { font: 'F2', size: size(12), color: accent });

  const salesLeft = splitLeft + splitWidth + splitGap;

  c.rect(splitTop, salesLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 8, salesLeft + 8, 'Sotuv', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 20, salesLeft + 8, String(params.metrics.newSalesCount), { font: 'F2', size: size(10), color: accent });
  c.text(
    splitTop + 33,
    salesLeft + 8,
    `On: ${params.metrics.onlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );
  c.text(
    splitTop + 43,
    salesLeft + 8,
    `Of: ${params.metrics.offlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );

  const summaryTop = cardRowTop(1) + cardHeight + 12;
  const summaryHeight = 72;

  c.rect(summaryTop, contentLeft, contentWidth, summaryHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  const summaryRows = [
    {
      left: `Sifatsiz lidlar: ${params.metrics.nonQualifiedLeads}`,
      right: `Qo'ng'iroqlar: ${params.metrics.totalCalls}`,
      rightSize: 10.5,
    },
    {
      left: `Yangi sotuvlar: ${params.metrics.newSalesCount}`,
      right: `Suhbat davomiyligi: ${formatDuration(params.metrics.talkDurationSeconds)}`,
      rightSize: 10.5,
    },
    {
      left: `Konversiya: ${params.metrics.conversionPercent.toFixed(2)}%`,
      right: `Online/Offline/Intensiv sotuvlar: ${params.metrics.onlineSalesCount}/${params.metrics.offlineSalesCount}/${params.metrics.intensiveSalesCount}`,
      rightSize: 8.7,
    },
  ];

  for (const [index, row] of summaryRows.entries()) {
    const rowTop = summaryTop + 10 + index * 20;

    c.text(rowTop, 54, row.left, { font: 'F2', size: size(11.5), color: textDark, maxWidth: 236 });
    c.text(rowTop, 300, row.right, { size: size(row.rightSize), color: textDark, maxWidth: 237 });
  }

  const breakdownRowHeight = 14;
  const breakdownColLeftA = 54;
  const breakdownColLeftB = 300;
  const drawBreakdownSection = (
    top: number,
    title: string,
    entries: Array<{ label: string; value: number }>,
  ): number => {
    c.rect(top, contentLeft, contentWidth, 22, { fill: dark });
    c.text(top + 4, 54, title, { font: 'F2', size: size(12), color: white });
    const layout = getBreakdownLayout(entries);

    for (let row = 0; row < layout.rowCount; row += 1) {
      const y = top + 28 + row * breakdownRowHeight;
      const left = layout.left[row];
      const right = layout.right[row];

      if (typeof left === 'string') {
        c.text(y, breakdownColLeftA, left, { size: size(9), color: textDark, maxWidth: breakdownColLeftB - breakdownColLeftA - 10 });
      }
      if (typeof right === 'string') {
        c.text(y, breakdownColLeftB, right, { size: size(9), color: textDark, maxWidth: contentLeft + contentWidth - breakdownColLeftB - 10 });
      }
    }

    return top + layout.height;
  };

  let cursor = summaryTop + summaryHeight + 12;

  cursor = drawBreakdownSection(cursor, 'Sifatsiz lid sabablari', params.metrics.reasonBreakdown);
  cursor = drawBreakdownSection(cursor, 'Lid manbalari', params.metrics.sourceBreakdown);

  const selectedCourseRows = params.metrics.selectedCourseRows || [];
  const hasSelectedCourses = selectedCourseRows.length > 0;

  if (hasSelectedCourses) {
    c.rect(cursor, contentLeft, contentWidth, 22, { fill: dark });
    c.text(cursor + 4, 54, 'Tanlangan kurslar sotuvi', { font: 'F2', size: size(12), color: white });
    const courseContentTop = cursor + 28;

    selectedCourseRows.slice(0, 3).forEach((row, index) => {
      c.text(courseContentTop + index * 14, 54, formatSelectedCourseLine(row), { size: size(8.3), color: textDark, maxWidth: contentWidth - 20 });
    });
    cursor = courseContentTop + Math.min(3, selectedCourseRows.length) * 14 + 8;
  }

  const columns = [
    { key: 'name', title: 'Menejer', width: 82 },
    { key: 'leads', title: 'Lid', width: 24 },
    { key: 'qualified', title: 'Sifatli', width: 34 },
    { key: 'nonQualified', title: 'Sifatsiz', width: 40 },
    { key: 'sales', title: 'Sotuv', width: 32 },
    { key: 'conversion', title: 'Konv.', width: 36 },
    { key: 'agreementAmount', title: 'Kelishuv', width: 44 },
    { key: 'incomeAmount', title: 'Tushum', width: 42 },
    { key: 'calls', title: "Qo'ng'iroq", width: 48 },
    { key: 'longCalls', title: '4+ daq', width: 36 },
    { key: 'duration', title: 'Suhbat soat', width: 58 },
  ] as const;
  const cellTextWidth = (width: number) => width - 4;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  const drawManagerColumnHeader = (top: number) => {
    c.rect(top, 54, tableWidth, 20, { fill: [0.92, 0.94, 0.98], stroke: lightBorder, lineWidth: 0.8 });
    let x = 56;

    for (const column of columns) {
      c.text(top + 5, x, column.title, {
        font: 'F2',
        size: c.fitSize(column.title, cellTextWidth(column.width), { size: size(7.4), minSize: 6, font: 'F2' }),
        color: textDark,
        maxWidth: cellTextWidth(column.width),
      });
      x += column.width;
    }
  };

  const drawManagerRow = (top: number, row: ReportManagerRow, index: number) => {
    c.rect(top, 54, tableWidth, 18, {
      fill: index % 2 === 0 ? ([1, 1, 1] as PdfColor) : ([0.98, 0.99, 1] as PdfColor),
      stroke: lightBorder,
      lineWidth: 0.4,
    });

    const values = [
      row.name,
      String(row.leads),
      String(row.qualified),
      String(row.nonQualified),
      String(row.sales),
      `${row.conversion.toFixed(1)}%`,
      formatCompactCurrency(row.agreementAmount),
      formatCompactCurrency(row.incomeAmount),
      String(row.callCount),
      String(row.longCallCount),
      formatClockHoursMinutes(row.callDurationSeconds),
    ];

    let currentX = 56;

    for (const [colIndex, column] of columns.entries()) {
      c.text(top + 4, currentX, values[colIndex] || '-', { size: size(7.2), color: textDark, maxWidth: cellTextWidth(column.width) });
      currentX += column.width;
    }
  };

  const drawContinuationPage = (): number => {
    c.addPage();
    c.rect(24, contentLeft, contentWidth, 50, { fill: dark });
    c.text(34, 54, params.tenantName, { font: 'F2', size: size(15), color: white, maxWidth: contentWidth - 20 });
    c.text(53, 54, `${params.title} | ${headerDateRange}`, {
      size: size(8.5),
      color: [0.76, 0.82, 0.92],
      maxWidth: contentWidth - 20,
    });
    c.rect(86, contentLeft, contentWidth, 22, { fill: dark });
    c.text(90, 54, "Menejerlar bo'yicha sotuvlar (davomi)", { font: 'F2', size: size(12), color: white });
    drawFooter();

    return 114;
  };

  const managerGroups = groupManagerRows(params.metrics.managerRows);

  if (managerGroups.length > 0) {
    c.rect(cursor, contentLeft, contentWidth, 22, { fill: dark });
    c.text(cursor + 4, 54, "Menejerlar bo'yicha sotuvlar", { font: 'F2', size: size(12), color: white });
    cursor += 28;

    for (const managerGroup of managerGroups) {
      let remainingRows = managerGroup.rows;
      let continuation = false;

      while (remainingRows.length > 0) {
        const minimumGroupHeight = 18 + 20 + 18;

        if (cursor + minimumGroupHeight > pageContentBottom) {
          cursor = drawContinuationPage();
        }

        c.rect(cursor, 54, tableWidth, 18, {
          fill: cardBg,
          stroke: lightBorder,
          lineWidth: 0.8,
        });
        c.text(cursor + 3, 56, continuation ? `${managerGroup.label} (davomi)` : managerGroup.label, {
          font: 'F2',
          size: size(8.5),
          color: textDark,
        });
        cursor += 18;
        drawManagerColumnHeader(cursor);
        cursor += 20;

        const availableRows = Math.max(1, Math.floor((pageContentBottom - cursor) / 18));
        const pageRows = remainingRows.slice(0, availableRows);

        for (const [index, row] of pageRows.entries()) {
          drawManagerRow(cursor, row, index);
          cursor += 18;
        }
        remainingRows = remainingRows.slice(pageRows.length);

        if (remainingRows.length > 0) {
          continuation = true;
          cursor = drawContinuationPage();
        } else {
          cursor += 6;
        }
      }
    }
  }

  return c.build();
}
