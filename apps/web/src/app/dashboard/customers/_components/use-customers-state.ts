'use client';

import { useAuth } from '@/contexts/auth-context';
import { isAdminLike } from '@dashboarduz/shared';
import { trpc } from '@/lib/trpc';
import type { DebtFilter } from '@dashboarduz/shared';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_ROLES } from './customer-helpers';

export function useCustomersState() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = isAdminLike(user?.roles);
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('TeamLeader')
      && !roles.some((role) => AGENT_ROLES.has(role))
      && !roles.includes('Finance'),
  );
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all');
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [bulkCourseId, setBulkCourseId] = useState('');
  const [bulkTariffId, setBulkTariffId] = useState('');
  const [bulkSubTariffId, setBulkSubTariffId] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCustomerNumber, setNewCustomerNumber] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newTelegram, setNewTelegram] = useState('');
  const [newCourseId, setNewCourseId] = useState('');
  const [newTariffId, setNewTariffId] = useState('');
  const [newSubTariffId, setNewSubTariffId] = useState('');
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const [identityCustomerId, setIdentityCustomerId] = useState('');
  const [identityCustomerNumber, setIdentityCustomerNumber] = useState('');
  const [identityCustomerName, setIdentityCustomerName] = useState('');
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');
  const [detailsCustomerId, setDetailsCustomerId] = useState('');
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isCourseEditorModalOpen, setIsCourseEditorModalOpen] = useState(false);
  const [courseEditorCustomerId, setCourseEditorCustomerId] = useState('');
  const [editingSaleIncomeId, setEditingSaleIncomeId] = useState('');
  const [courseEditCourseId, setCourseEditCourseId] = useState('');
  const [courseEditTariffId, setCourseEditTariffId] = useState('');
  const [courseEditSubTariffId, setCourseEditSubTariffId] = useState('');
  const customersQuery = trpc.customerIncome.listCustomers.useQuery(
    {
      query: query.trim() || undefined,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      debtFilter,
    },
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );
  const editorOptionsQuery = trpc.customerIncome.customerEditorOptions.useQuery(undefined, {
    retry: false,
    enabled: isAdmin && (editMode || isAddModalOpen || isIdentityModalOpen || isCourseEditorModalOpen),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const createCustomerOnlyMutation = trpc.customerIncome.createCustomerOnly.useMutation();
  const updateCustomerIdentityMutation = trpc.customerIncome.updateCustomerIdentity.useMutation();
  const updateCustomersCourseAssignmentMutation = trpc.customerIncome.updateCustomersCourseAssignment.useMutation();
  const deleteCustomersMutation = trpc.customerIncome.deleteCustomers.useMutation();
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();
  const updateCustomerCourseSaleMutation = trpc.customerIncome.updateCustomerCourseSale.useMutation();
  const customerHistoryQuery = trpc.customerIncome.customerPaymentHistory.useQuery(
    { customerId: detailsCustomerId || '00000000-0000-0000-0000-000000000000' },
    {
      enabled: isDetailsModalOpen && Boolean(detailsCustomerId),
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  );
  const customers = useMemo(() => customersQuery.data?.customers || [], [customersQuery.data]);
  const courseOptions = useMemo(() => customersQuery.data?.courseOptions || [], [customersQuery.data]);
  const catalogOptions = useMemo(() => customersQuery.data?.catalogOptions || [], [customersQuery.data]);
  const summaryCounts = useMemo(() => customersQuery.data?.summaryCounts || null, [customersQuery.data]);
  const withDebtCount = summaryCounts?.withDebtCustomers ?? customers.filter((customer: any) => customer.hasDebt).length;
  const totalCustomersCount = summaryCounts?.totalCustomers ?? customers.length;
  const withoutDebtCount = summaryCounts?.withoutDebtCustomers ?? Math.max(customers.length - withDebtCount, 0);
  const courseEditorCustomer = useMemo(
    () => customers.find((customer: any) => customer.id === courseEditorCustomerId) || null,
    [customers, courseEditorCustomerId],
  );
  const filterTariffOptions = useMemo(() => {
    if (!courseId) {
      return [];
    }
    const course = (catalogOptions as any[]).find((item: any) => item.id === courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [catalogOptions, courseId]);
  const filterSubTariffOptions = useMemo(() => {
    if (!tariffId) {
      return [];
    }
    const tariff = (filterTariffOptions as any[]).find((item: any) => item.id === tariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [filterTariffOptions, tariffId]);
  const editorCourses = useMemo(() => editorOptionsQuery.data || [], [editorOptionsQuery.data]);
  const bulkTariffOptions = useMemo(() => {
    if (!bulkCourseId) {
      return [];
    }
    const course = editorCourses.find((item: any) => item.id === bulkCourseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [editorCourses, bulkCourseId]);
  const bulkSubTariffOptions = useMemo(() => {
    if (!bulkTariffId) {
      return [];
    }
    const tariff = bulkTariffOptions.find((item: any) => item.id === bulkTariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [bulkTariffId, bulkTariffOptions]);
  const newTariffOptions = useMemo(() => {
    if (!newCourseId) {
      return [];
    }
    const course = editorCourses.find((item: any) => item.id === newCourseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [editorCourses, newCourseId]);
  const newSubTariffOptions = useMemo(() => {
    if (!newTariffId) {
      return [];
    }
    const tariff = newTariffOptions.find((item: any) => item.id === newTariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [newTariffId, newTariffOptions]);
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
  useEffect(() => {
    if (!editMode) {
      setSelectedCustomerIds([]);
      setBulkCourseId('');
      setBulkTariffId('');
      setBulkSubTariffId('');
    }
  }, [editMode]);
  useEffect(() => {
    if (!courseId) {
      setTariffId('');
      setSubTariffId('');
      return;
    }
    if (
      tariffId
      && filterTariffOptions.length > 0
      && !filterTariffOptions.some((item: any) => item.id === tariffId)
    ) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [courseId, tariffId, filterTariffOptions]);
  useEffect(() => {
    if (!tariffId) {
      setSubTariffId('');
      return;
    }
    if (
      subTariffId
      && filterSubTariffOptions.length > 0
      && !filterSubTariffOptions.some((item: any) => item.id === subTariffId)
    ) {
      setSubTariffId('');
    }
  }, [tariffId, subTariffId, filterSubTariffOptions]);
  useEffect(() => {
    if (!bulkCourseId) {
      setBulkTariffId('');
      setBulkSubTariffId('');
      return;
    }
    if (bulkTariffId && !bulkTariffOptions.some((item: any) => item.id === bulkTariffId)) {
      setBulkTariffId('');
      setBulkSubTariffId('');
    }
  }, [bulkCourseId, bulkTariffId, bulkTariffOptions]);
  useEffect(() => {
    if (!bulkTariffId) {
      setBulkSubTariffId('');
      return;
    }
    if (bulkSubTariffId && !bulkSubTariffOptions.some((item: any) => item.id === bulkSubTariffId)) {
      setBulkSubTariffId('');
    }
  }, [bulkTariffId, bulkSubTariffId, bulkSubTariffOptions]);
  useEffect(() => {
    if (!newCourseId) {
      setNewTariffId('');
      setNewSubTariffId('');
      return;
    }
    if (newTariffId && !newTariffOptions.some((item: any) => item.id === newTariffId)) {
      setNewTariffId('');
      setNewSubTariffId('');
    }
  }, [newCourseId, newTariffId, newTariffOptions]);
  useEffect(() => {
    if (!newTariffId) {
      setNewSubTariffId('');
      return;
    }
    if (newSubTariffId && !newSubTariffOptions.some((item: any) => item.id === newSubTariffId)) {
      setNewSubTariffId('');
    }
  }, [newTariffId, newSubTariffId, newSubTariffOptions]);
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

  return { user, roles, isAdmin, isTashkiliyOnly, searchInput, setSearchInput, query, setQuery, courseId, setCourseId, tariffId, setTariffId, subTariffId, setSubTariffId, debtFilter, setDebtFilter, pageError, setPageError, pageSuccess, setPageSuccess, editMode, setEditMode, selectedCustomerIds, setSelectedCustomerIds, bulkCourseId, setBulkCourseId, bulkTariffId, setBulkTariffId, bulkSubTariffId, setBulkSubTariffId, isAddModalOpen, setIsAddModalOpen, newCustomerNumber, setNewCustomerNumber, newCustomerName, setNewCustomerName, newTelegram, setNewTelegram, newCourseId, setNewCourseId, newTariffId, setNewTariffId, newSubTariffId, setNewSubTariffId, isIdentityModalOpen, setIsIdentityModalOpen, identityCustomerId, setIdentityCustomerId, identityCustomerNumber, setIdentityCustomerNumber, identityCustomerName, setIdentityCustomerName, deletingCourseSaleId, setDeletingCourseSaleId, detailsCustomerId, setDetailsCustomerId, isDetailsModalOpen, setIsDetailsModalOpen, isCourseEditorModalOpen, setIsCourseEditorModalOpen, courseEditorCustomerId, setCourseEditorCustomerId, editingSaleIncomeId, setEditingSaleIncomeId, courseEditCourseId, setCourseEditCourseId, courseEditTariffId, setCourseEditTariffId, courseEditSubTariffId, setCourseEditSubTariffId, customersQuery, editorOptionsQuery, createCustomerOnlyMutation, updateCustomerIdentityMutation, updateCustomersCourseAssignmentMutation, deleteCustomersMutation, deleteCustomerCourseMutation, updateCustomerCourseSaleMutation, customerHistoryQuery, customers, courseOptions, catalogOptions, summaryCounts, withDebtCount, totalCustomersCount, withoutDebtCount, courseEditorCustomer, filterTariffOptions, filterSubTariffOptions, editorCourses, bulkTariffOptions, bulkSubTariffOptions, newTariffOptions, newSubTariffOptions, editTariffOptions, editSubTariffOptions };
}
