'use client';

import { useAuth } from '@/contexts/auth-context';
import { isAdminLike } from '@dashboarduz/shared';
import { trpc } from '@/lib/trpc';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_ROLES, type CourseTypeSalesViewProps } from './category-sales-helpers';

export function useCategorySalesState({
  category,
  title,
  description,
}: CourseTypeSalesViewProps) {
  const { user } = useAuth();
  const trpcUtils = trpc.useUtils();
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const isAdmin = isAdminLike(roles);
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('TeamLeader')
      && !roles.some((role) => AGENT_ROLES.has(role))
      && !roles.includes('Finance'),
  );
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');
  const [isCourseEditorModalOpen, setIsCourseEditorModalOpen] = useState(false);
  const [courseEditorCustomerId, setCourseEditorCustomerId] = useState('');
  const [editingSaleIncomeId, setEditingSaleIncomeId] = useState('');
  const [courseEditCourseId, setCourseEditCourseId] = useState('');
  const [courseEditTariffId, setCourseEditTariffId] = useState('');
  const [courseEditSubTariffId, setCourseEditSubTariffId] = useState('');
  const optionsQuery = trpc.courseSales.typeOptions.useQuery(
    { category },
    {
      retry: false,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const editorOptionsQuery = trpc.customerIncome.customerEditorOptions.useQuery(undefined, {
    retry: false,
    enabled: isAdmin && isCourseEditorModalOpen,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();
  const updateCustomerCourseSaleMutation = trpc.customerIncome.updateCustomerCourseSale.useMutation();
  const courses = useMemo(() => optionsQuery.data?.courses || [], [optionsQuery.data]);
  const selectedCourse = useMemo(
    () => (courses as any[]).find((course: any) => course.id === courseId) || null,
    [courseId, courses],
  );
  const scopeCourses = useMemo(
    () => (courseId ? (courses as any[]).filter((course: any) => course.id === courseId) : (courses as any[])),
    [courseId, courses],
  );
  const tariffOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; subTariffs: Array<{ id: string; name: string }> }>();
    for (const course of scopeCourses) {
      for (const tariff of course.tariffs || []) {
        if (!map.has(tariff.id)) {
          map.set(tariff.id, tariff);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopeCourses]);
  const subTariffOptions = useMemo(() => {
    if (tariffId) {
      const selectedTariff = tariffOptions.find((tariff) => tariff.id === tariffId);
      return (selectedTariff?.subTariffs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    }
    const map = new Map<string, { id: string; name: string }>();
    for (const tariff of tariffOptions) {
      for (const subTariff of tariff.subTariffs || []) {
        if (!map.has(subTariff.id)) {
          map.set(subTariff.id, subTariff);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tariffId, tariffOptions]);
  useEffect(() => {
    if (!courseId) {
      return;
    }
    if (!(courses as any[]).some((course: any) => course.id === courseId)) {
      setCourseId('');
    }
  }, [courseId, courses]);
  useEffect(() => {
    if (!tariffId) {
      return;
    }
    if (!tariffOptions.some((tariff) => tariff.id === tariffId)) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [tariffId, tariffOptions]);
  useEffect(() => {
    if (!subTariffId) {
      return;
    }
    if (!subTariffOptions.some((subTariff) => subTariff.id === subTariffId)) {
      setSubTariffId('');
    }
  }, [subTariffId, subTariffOptions]);
  useEffect(() => {
    setPage(1);
  }, [courseId, tariffId, subTariffId, searchQuery]);
  const summaryQuery = trpc.courseSales.typeSummary.useQuery(
    {
      category,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
    },
    {
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 3 * 60 * 1000,
    },
  );
  const customersQuery = trpc.courseSales.typeCustomers.useQuery(
    {
      category,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      query: searchQuery || undefined,
      page,
      limit,
    },
    {
      retry: 1,
      keepPreviousData: true,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 3 * 60 * 1000,
    },
  );
  const summary = summaryQuery.data?.totals;
  const tariffBreakdown = summaryQuery.data?.tariffBreakdown;
  const salesBreakdown = summaryQuery.data?.salesBreakdown;
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
    const course = editorCourses.find((item: any) => item.id === courseEditCourseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [editorCourses, courseEditCourseId]);
  const editSubTariffOptions = useMemo(() => {
    if (!courseEditTariffId) {
      return [];
    }
    const tariff = editTariffOptions.find((item: any) => item.id === courseEditTariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
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
  useEffect(() => {
    if (!editingSaleIncomeId || !courseEditTariffId) {
      return;
    }
    if (editSubTariffOptions.length > 0 && !courseEditSubTariffId) {
      setCourseEditSubTariffId(editSubTariffOptions[0].id);
    }
  }, [editingSaleIncomeId, courseEditTariffId, courseEditSubTariffId, editSubTariffOptions]);

  return { category, title, description, user, trpcUtils, roles, isAdmin, isTashkiliyOnly, courseId, setCourseId, tariffId, setTariffId, subTariffId, setSubTariffId, searchInput, setSearchInput, searchQuery, setSearchQuery, page, setPage, limit, actionError, setActionError, actionSuccess, setActionSuccess, deletingCourseSaleId, setDeletingCourseSaleId, isCourseEditorModalOpen, setIsCourseEditorModalOpen, courseEditorCustomerId, setCourseEditorCustomerId, editingSaleIncomeId, setEditingSaleIncomeId, courseEditCourseId, setCourseEditCourseId, courseEditTariffId, setCourseEditTariffId, courseEditSubTariffId, setCourseEditSubTariffId, optionsQuery, editorOptionsQuery, deleteCustomerCourseMutation, updateCustomerCourseSaleMutation, courses, selectedCourse, scopeCourses, tariffOptions, subTariffOptions, summaryQuery, customersQuery, summary, tariffBreakdown, salesBreakdown, customers, editorCourses, courseEditorCustomer, editTariffOptions, editSubTariffOptions, pagination };
}
