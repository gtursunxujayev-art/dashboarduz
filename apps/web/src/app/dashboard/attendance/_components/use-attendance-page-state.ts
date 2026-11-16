'use client';

import { useAuth } from '@/contexts/auth-context';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { useMemo, useState } from 'react';
import { ATTENDANCE_DAILY_COLUMN_WIDTHS, ATTENDANCE_DAILY_DURATION_COLUMNS, ATTENDANCE_DAILY_HEADERS, ATTENDANCE_DAILY_SHEET_NAME, ATTENDANCE_SUMMARY_COLUMN_WIDTHS, ATTENDANCE_SUMMARY_DURATION_COLUMNS, ATTENDANCE_SUMMARY_HEADERS, ATTENDANCE_SUMMARY_SHEET_NAME, buildAttendanceDailyExportRows, buildAttendanceSummaryExportRows, getAttendanceReportFilename } from '../attendance-report-export';
import { AGENT_ROLES, getNowTashkentDateTimeLocal, getTodayTashkentDate, hasInPresence } from './attendance-helpers';

export function useAttendancePageState() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = roles.includes('Admin');
  const canReadAnomalies = roles.includes('Admin') || roles.includes('Manager') || roles.includes('TeamLeader');
  const today = useMemo(() => getTodayTashkentDate(), []);
  const nowDateTime = useMemo(() => getNowTashkentDateTimeLocal(), []);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [query, setQuery] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [correctionAction, setCorrectionAction] = useState<'add_missing_in' | 'add_missing_out' | 'edit_event_time' | 'mark_justified_absence'>('add_missing_out');
  const [correctionUserId, setCorrectionUserId] = useState('');
  const [correctionEventId, setCorrectionEventId] = useState('');
  const [correctionTimestamp, setCorrectionTimestamp] = useState(nowDateTime);
  const [correctionSummaryDate, setCorrectionSummaryDate] = useState(today);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSuccess, setCorrectionSuccess] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const usersQuery = trpc.users.list.useQuery(undefined, {
    enabled: isAdmin || dateFrom === dateTo,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const summariesQuery = trpc.attendance.listDailySummaries.useQuery(
    {
      page: 1,
      limit: 100,
      dateFrom,
      dateTo,
      query: query || undefined,
      anomaliesOnly,
    },
    {
      keepPreviousData: true,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const eventsQuery = trpc.attendance.listEvents.useQuery(
    {
      page: 1,
      limit: 25,
      dateFrom,
      dateTo,
      query: query || undefined,
    },
    {
      keepPreviousData: true,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const anomaliesQuery = trpc.attendance.listAnomalies.useQuery(
    {
      dateFrom,
      dateTo,
      limit: 40,
    },
    {
      enabled: canReadAnomalies && anomaliesOnly,
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const recomputeMutation = trpc.attendance.recomputeRange.useMutation({
    onSuccess: async () => {
      await Promise.all([
        summariesQuery.refetch(),
        eventsQuery.refetch(),
        canReadAnomalies ? anomaliesQuery.refetch() : Promise.resolve(),
      ]);
    },
  });
  const exportReportMutation = trpc.attendance.exportReport.useMutation();
  const correctionMutation = trpc.attendance.applyCorrection.useMutation({
    onSuccess: async () => {
      setCorrectionSuccess("Tuzatish muvaffaqiyatli saqlandi.");
      setCorrectionError(null);
      await Promise.all([
        summariesQuery.refetch(),
        eventsQuery.refetch(),
        canReadAnomalies ? anomaliesQuery.refetch() : Promise.resolve(),
      ]);
    },
    onError: (error) => {
      setCorrectionSuccess(null);
      setCorrectionError(error.message || "Tuzatishni saqlashda xatolik.");
    },
  });
  const totals = useMemo(() => {
    const rows = summariesQuery.data?.rows || [];
    return rows.reduce(
      (acc, row: any) => {
        acc.workedSeconds += row.workedSeconds || 0;
        acc.requiredSeconds += row.requiredSeconds || 0;
        acc.missingSeconds += row.missingSeconds || 0;
        acc.lateMinutes += row.lateMinutes || 0;
        acc.absenceDays += row.absence ? 1 : 0;
        acc.anomalies += row.anomalyCount || 0;
        return acc;
      },
      {
        workedSeconds: 0,
        requiredSeconds: 0,
        missingSeconds: 0,
        lateMinutes: 0,
        absenceDays: 0,
        anomalies: 0,
      },
    );
  }, [summariesQuery.data?.rows]);
  const presenceByUserDate = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of summariesQuery.data?.rows || []) {
      const key = `${row.userId || ''}|${row.summaryDate || ''}`;
      map.set(key, hasInPresence(row));
    }
    return map;
  }, [summariesQuery.data?.rows]);
  const userOptions = useMemo(
    () =>
      (usersQuery.data || [])
        .filter((currentUser: any) => Array.isArray(currentUser.roles) && currentUser.isActive !== false)
        .map((currentUser: any) => ({
          id: currentUser.id as string,
          label: (currentUser.name as string | null) || (currentUser.username as string | null) || currentUser.id,
        })),
    [usersQuery.data],
  );
  const allAgentUsers = useMemo(
    () =>
      (usersQuery.data || []).filter((currentUser: any) => {
        if (!Array.isArray(currentUser.roles) || currentUser.isActive === false) return false;
        return currentUser.roles.some((role: string) => AGENT_ROLES.has(role)) || currentUser.roles.includes('TeamLeader');
      }),
    [usersQuery.data],
  );
  const displayRows = useMemo(() => {
    const rows = summariesQuery.data?.rows || [];
    const singleDay = dateFrom === dateTo;
    if (!singleDay) return rows;

    const normalizedQuery = query.trim().toLowerCase();
    if (allAgentUsers.length === 0) return rows;
    const filteredAgents = allAgentUsers.filter((agent: any) => {
      if (!normalizedQuery) return true;
      const haystack = [
        agent.name || '',
        agent.username || '',
        agent.phoneNumber || '',
        agent.phone || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    if (filteredAgents.length === 0) return normalizedQuery ? [] : rows;

    const byUserId = new Map<string, any>();
    for (const row of rows) {
      if (row?.userId) byUserId.set(row.userId, row);
    }

    return filteredAgents
      .map((agent: any) => {
        const existing = byUserId.get(agent.id);
        if (existing) return existing;
        return {
          id: `missing-${agent.id}-${dateFrom}`,
          summaryDate: dateFrom,
          userId: agent.id,
          user: {
            name: agent.name || null,
            username: agent.username || null,
          },
          workedSeconds: null,
          missingSeconds: null,
          lateMinutes: null,
          firstInAt: null,
          lastOutAt: null,
          inCount: 0,
        };
      })
      .sort((a: any, b: any) => {
        const nameA = (a.user?.name || a.user?.username || '').toLowerCase();
        const nameB = (b.user?.name || b.user?.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [summariesQuery.data?.rows, dateFrom, dateTo, query, allAgentUsers]);
  const presentCount = useMemo(() => displayRows.filter((row: any) => hasInPresence(row)).length, [displayRows]);
  const eventOptions = useMemo(
    () =>
      (eventsQuery.data?.rows || [])
        .filter((row: any) => typeof row.id === 'string')
        .map((row: any) => ({
          id: row.id as string,
          label: `${row.localDate || '-'} | ${row.action || '-'} | ${(row.user?.name as string) || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'} | ${formatDateTime(row.eventAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}`,
        })),
    [eventsQuery.data?.rows],
  );
  const handleApplyCorrection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    setCorrectionSuccess(null);
    setCorrectionError(null);

    const reason = correctionReason.trim();
    if (!reason) {
      setCorrectionError('Izoh majburiy.');
      return;
    }

    try {
      if (correctionAction === 'add_missing_in' || correctionAction === 'add_missing_out') {
        if (!correctionUserId) {
          setCorrectionError("Xodimni tanlang.");
          return;
        }
        await correctionMutation.mutateAsync({
          action: correctionAction,
          userId: correctionUserId,
          timestamp: new Date(correctionTimestamp).toISOString(),
          reason,
        });
        return;
      }

      if (correctionAction === 'edit_event_time') {
        if (!correctionEventId) {
          setCorrectionError('Event tanlanmagan.');
          return;
        }
        await correctionMutation.mutateAsync({
          action: 'edit_event_time',
          eventId: correctionEventId,
          timestamp: new Date(correctionTimestamp).toISOString(),
          reason,
        });
        return;
      }

      if (!correctionUserId) {
        setCorrectionError("Xodimni tanlang.");
        return;
      }
      await correctionMutation.mutateAsync({
        action: 'mark_justified_absence',
        userId: correctionUserId,
        summaryDate: correctionSummaryDate,
        reason,
      });
    } catch {
      // handled by mutation onError
    }
  };
  const handleExportReport = async () => {
    setExportSuccess(null);
    setExportError(null);

    try {
      // Search and anomaly-only are intentionally not part of the period report.
      const report = await exportReportMutation.mutateAsync({ dateFrom, dateTo });
      if (report.employeeCount === 0 || report.dailyRowCount === 0) {
        setExportError("Tanlangan davr uchun eksport qilinadigan davomat ma'lumoti topilmadi.");
        return;
      }

      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();

      const appendSheet = (
        sheetName: string,
        headers: readonly string[],
        rows: Array<Array<string | number | null>>,
        columnWidths: readonly number[],
        durationColumns: readonly number[],
      ) => {
        const worksheet = XLSX.utils.aoa_to_sheet([Array.from(headers), ...rows]);
        worksheet['!cols'] = columnWidths.map((wch) => ({ wch }));
        worksheet['!autofilter'] = {
          ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: rows.length, c: headers.length - 1 },
          }),
        };

        for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
          for (const columnIndex of durationColumns) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
            if (cell?.t === 'n') cell.z = '[h]:mm:ss';
          }
        }
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      };

      appendSheet(
        ATTENDANCE_SUMMARY_SHEET_NAME,
        ATTENDANCE_SUMMARY_HEADERS,
        buildAttendanceSummaryExportRows(report.employeeSummaries),
        ATTENDANCE_SUMMARY_COLUMN_WIDTHS,
        ATTENDANCE_SUMMARY_DURATION_COLUMNS,
      );
      appendSheet(
        ATTENDANCE_DAILY_SHEET_NAME,
        ATTENDANCE_DAILY_HEADERS,
        buildAttendanceDailyExportRows(report.dailyRows),
        ATTENDANCE_DAILY_COLUMN_WIDTHS,
        ATTENDANCE_DAILY_DURATION_COLUMNS,
      );

      XLSX.writeFile(workbook, getAttendanceReportFilename(report.dateFrom, report.dateTo), {
        bookType: 'xlsx',
      });
      setExportSuccess(
        `${report.employeeCount} xodim va ${report.dailyRowCount} kunlik qator XLSX faylga yuklandi.`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Davomat hisobotini yuklab olishda xatolik yuz berdi.");
    }
  };

  return { user, roles, isAdmin, canReadAnomalies, today, nowDateTime, dateFrom, setDateFrom, dateTo, setDateTo, query, setQuery, anomaliesOnly, setAnomaliesOnly, correctionAction, setCorrectionAction, correctionUserId, setCorrectionUserId, correctionEventId, setCorrectionEventId, correctionTimestamp, setCorrectionTimestamp, correctionSummaryDate, setCorrectionSummaryDate, correctionReason, setCorrectionReason, correctionSuccess, setCorrectionSuccess, correctionError, setCorrectionError, exportSuccess, setExportSuccess, exportError, setExportError, usersQuery, summariesQuery, eventsQuery, anomaliesQuery, recomputeMutation, exportReportMutation, correctionMutation, totals, presenceByUserDate, userOptions, allAgentUsers, displayRows, presentCount, eventOptions, handleApplyCorrection, handleExportReport };
}
