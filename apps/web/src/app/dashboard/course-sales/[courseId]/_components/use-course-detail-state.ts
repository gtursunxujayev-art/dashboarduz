'use client';

import { useAuth } from '@/contexts/auth-context';
import { getTashkentToday } from '@/lib/date-range';
import { trpc } from '@/lib/trpc';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_ROLES, type DetailTab } from './course-detail-helpers';

export function useCourseDetailState() {
  const { user } = useAuth();
  const trpcUtils = trpc.useUtils();
  const roles = user?.roles || [];
  const isAdmin = Boolean(roles.includes('Admin'));
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('TeamLeader')
      && !roles.some((role) => AGENT_ROLES.has(role))
      && !roles.includes('Finance'),
  );
  const params = useParams<{ courseId: string }>();
  const courseId = String(params?.courseId || '');
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [tab, setTab] = useState<DetailTab>('umumiy');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');
  const [isCourseEditorModalOpen, setIsCourseEditorModalOpen] = useState(false);
  const [courseEditorCustomerId, setCourseEditorCustomerId] = useState('');
  const [editingSaleIncomeId, setEditingSaleIncomeId] = useState('');
  const [courseEditCourseId, setCourseEditCourseId] = useState('');
  const [courseEditTariffId, setCourseEditTariffId] = useState('');
  const [courseEditSubTariffId, setCourseEditSubTariffId] = useState('');
  const optionsQuery = trpc.courseSales.options.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const editorOptionsQuery = trpc.customerIncome.customerEditorOptions.useQuery(undefined, {
    retry: false,
    enabled: isAdmin && isCourseEditorModalOpen,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();
  const updateCustomerCourseSaleMutation = trpc.customerIncome.updateCustomerCourseSale.useMutation();
  const course = useMemo(
    () => (optionsQuery.data?.courses || []).find((item: any) => item.id === courseId) || null,
    [courseId, optionsQuery.data?.courses],
  );
  const tariffOptions = useMemo(() => course?.tariffs || [], [course]);
  const subTariffOptions = useMemo(() => {
    if (!course) {
      return [];
    }
    if (tariffId) {
      const selectedTariff = tariffOptions.find((tariff: any) => tariff.id === tariffId);
      return selectedTariff?.subTariffs || [];
    }
    const map = new Map<string, { id: string; name: string }>();
    for (const tariff of tariffOptions) {
      for (const subTariff of tariff.subTariffs || []) {
        if (!map.has(subTariff.id)) {
          map.set(subTariff.id, subTariff);
        }
      }
    }
    return Array.from(map.values());
  }, [course, tariffId, tariffOptions]);
  const detailQuery = trpc.courseSales.courseDetail.useQuery(
    {
      courseId,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      enabled: Boolean(courseId),
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 3 * 60 * 1000,
    },
  );
  const customersQuery = trpc.courseSales.customers.useQuery(
    {
      courseId,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      query: searchQuery || undefined,
      // Same period as the summary cards; without it the API silently defaults to this month.
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
      page,
      limit: 50,
    },
    {
      enabled: Boolean(courseId),
      retry: 1,
      keepPreviousData: true,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 3 * 60 * 1000,
    },
  );
  const summary = detailQuery.data?.summary;
  const tariffRows = detailQuery.data?.tariffRows || [];
  const managerRows = detailQuery.data?.managerRows || [];
  const customers = useMemo(
    () => customersQuery.data?.rows ?? [],
    [customersQuery.data?.rows],
  );
  const editorCourses = useMemo(() => editorOptionsQuery.data || [], [editorOptionsQuery.data]);
  const courseEditorCustomer = useMemo(
    () => customers.find((row: any) => row.customerId === courseEditorCustomerId) || null,
    [customers, courseEditorCustomerId],
  );
  const editTariffOptions = useMemo(() => {
    if (!courseEditCourseId) {
      return [];
    }
    const courseOption = editorCourses.find((item: any) => item.id === courseEditCourseId);
    return Array.isArray(courseOption?.tariffs) ? courseOption.tariffs : [];
  }, [editorCourses, courseEditCourseId]);
  const editSubTariffOptions = useMemo(() => {
    if (!courseEditTariffId) {
      return [];
    }
    const tariffOption = editTariffOptions.find((item: any) => item.id === courseEditTariffId);
    return Array.isArray(tariffOption?.subTariffs) ? tariffOption.subTariffs : [];
  }, [courseEditTariffId, editTariffOptions]);
  const pagination = {
    page: customersQuery.data?.page || 1,
    totalPages: customersQuery.data?.totalPages || 1,
    total: customersQuery.data?.total || 0,
  };
  useEffect(() => {
    if (!courseEditCourseId) {
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
      return;
    }
    if (courseEditTariffId && !editTariffOptions.some((item: any) => item.id === courseEditTariffId)) {
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
    }
  }, [courseEditCourseId, courseEditTariffId, editTariffOptions]);
  useEffect(() => {
    if (!courseEditTariffId) {
      setCourseEditSubTariffId('');
      return;
    }
    if (courseEditSubTariffId && !editSubTariffOptions.some((item: any) => item.id === courseEditSubTariffId)) {
      setCourseEditSubTariffId('');
    }
  }, [courseEditTariffId, courseEditSubTariffId, editSubTariffOptions]);
  // A new filter can have fewer pages than the current page number.
  useEffect(() => {
    setPage(1);
  }, [range, dateFrom, dateTo, tariffId, subTariffId, searchQuery]);
  useEffect(() => {
    if (!editingSaleIncomeId || !courseEditTariffId) {
      return;
    }
    if (editSubTariffOptions.length > 0 && !courseEditSubTariffId) {
      setCourseEditSubTariffId(editSubTariffOptions[0].id);
    }
  }, [editingSaleIncomeId, courseEditTariffId, courseEditSubTariffId, editSubTariffOptions]);

  return { user, trpcUtils, roles, isAdmin, isTashkiliyOnly, params, courseId, range, setRange, dateFrom, setDateFrom, dateTo, setDateTo, tariffId, setTariffId, subTariffId, setSubTariffId, tab, setTab, searchInput, setSearchInput, searchQuery, setSearchQuery, page, setPage, actionError, setActionError, actionSuccess, setActionSuccess, deletingCourseSaleId, setDeletingCourseSaleId, isCourseEditorModalOpen, setIsCourseEditorModalOpen, courseEditorCustomerId, setCourseEditorCustomerId, editingSaleIncomeId, setEditingSaleIncomeId, courseEditCourseId, setCourseEditCourseId, courseEditTariffId, setCourseEditTariffId, courseEditSubTariffId, setCourseEditSubTariffId, optionsQuery, editorOptionsQuery, deleteCustomerCourseMutation, updateCustomerCourseSaleMutation, course, tariffOptions, subTariffOptions, detailQuery, customersQuery, summary, tariffRows, managerRows, customers, editorCourses, courseEditorCustomer, editTariffOptions, editSubTariffOptions, pagination };
}
