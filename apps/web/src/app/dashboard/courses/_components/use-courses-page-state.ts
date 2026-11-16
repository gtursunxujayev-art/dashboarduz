'use client';

import { useAuth } from '@/contexts/auth-context';
import { COURSE_CATEGORY_OPTIONS } from '@/lib/course-categories';
import { trpc } from '@/lib/trpc';
import { type FormEvent, useMemo, useState } from 'react';
import { type CourseItem, type SubTariffItem, type TariffItem, toDateInputValue } from './courses-helpers';

export function useCoursesPageState() {
  const { user } = useAuth();
  const canManageCourses = Boolean(
    user?.roles?.includes('Admin')
    || user?.roles?.includes('Manager')
    || user?.roles?.includes('TeamLeader'),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCategory, setNewCourseCategory] = useState<CourseItem['category']>('offline');
  const [newCourseStartDate, setNewCourseStartDate] = useState('');
  const [newCourseEndDate, setNewCourseEndDate] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [newTariffName, setNewTariffName] = useState('');
  const [newSubTariffName, setNewSubTariffName] = useState<Record<string, string>>({});
  const [courseEditName, setCourseEditName] = useState<Record<string, string>>({});
  const [courseEditCategory, setCourseEditCategory] = useState<Record<string, CourseItem['category']>>({});
  const [courseEditStartDate, setCourseEditStartDate] = useState<Record<string, string>>({});
  const [courseEditEndDate, setCourseEditEndDate] = useState<Record<string, string>>({});
  const [tariffEditName, setTariffEditName] = useState<Record<string, string>>({});
  const [subTariffEditName, setSubTariffEditName] = useState<Record<string, string>>({});
  const [openCourseIds, setOchishCourseIds] = useState<Record<string, boolean>>({});
  const [openTariffIds, setOchishTariffIds] = useState<Record<string, boolean>>({});
  const [showSubTariffForm, setShowSubTariffForm] = useState<Record<string, boolean>>({});
  const catalogQuery = trpc.customerIncome.courseCatalog.useQuery(undefined, {
    retry: false,
  });
  const createCourse = trpc.customerIncome.createCourse.useMutation();
  const createTariff = trpc.customerIncome.createTariff.useMutation();
  const updateCourse = trpc.customerIncome.updateCourse.useMutation();
  const updateTariff = trpc.customerIncome.updateTariff.useMutation();
  const createSubTariff = trpc.customerIncome.createSubTariff.useMutation();
  const updateSubTariff = trpc.customerIncome.updateSubTariff.useMutation();
  const courses = useMemo<CourseItem[]>(() => {
    return ((catalogQuery.data || []) as Array<CourseItem & { isHiddenFromIncomeForm?: boolean; startDate?: Date | string | null; endDate?: Date | string | null }>).map((course) => ({
      ...course,
      startDate: course.startDate ?? null,
      endDate: course.endDate ?? null,
      isHiddenFromIncomeForm: Boolean(course.isHiddenFromIncomeForm),
    }));
  }, [catalogQuery.data]);
  const groupedCourses = useMemo(
    () =>
      COURSE_CATEGORY_OPTIONS.map((categoryOption) => ({
        ...categoryOption,
        courses: courses.filter((course) => course.category === categoryOption.value),
      })),
    [courses],
  );
  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };
  const toggleCourseOchish = (courseId: string) => {
    setOchishCourseIds((prev) => ({ [courseId]: !prev[courseId] }));
  };
  const toggleTariffOchish = (tariffId: string) => {
    setOchishTariffIds((prev) => ({ [tariffId]: !prev[tariffId] }));
  };
  const toggleSubTariffForm = (tariffId: string) => {
    setShowSubTariffForm((prev) => ({ ...prev, [tariffId]: !prev[tariffId] }));
  };
  const handleCreateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!canManageCourses) {
      setError("Faqat admin yoki manager kurslarni boshqara oladi.");
      return;
    }

    const name = newCourseName.trim();
    if (!name) {
      setError('Kurs nomi majburiy.');
      return;
    }

    try {
      await createCourse.mutateAsync({
        name,
        category: newCourseCategory,
        startDate: newCourseStartDate || undefined,
        endDate: newCourseEndDate || undefined,
      });
      setNewCourseName('');
      setNewCourseCategory('offline');
      setNewCourseStartDate('');
      setNewCourseEndDate('');
      setSuccess('Kurs muvaffaqiyatli saqlandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Kursni saqlashda xatolik.');
    }
  };
  const handleCreateTariff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!canManageCourses) {
      setError("Faqat admin yoki manager tariflarni boshqara oladi.");
      return;
    }

    const name = newTariffName.trim();
    if (!selectedCourseId) {
      setError('Avval kursni tanlang.');
      return;
    }
    if (!name) {
      setError('Tarif nomi majburiy.');
      return;
    }

    try {
      await createTariff.mutateAsync({
        courseId: selectedCourseId,
        name,
      });
      setNewTariffName('');
      setSuccess('Tarif muvaffaqiyatli saqlandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Tarifni saqlashda xatolik.');
    }
  };
  const handleUpdateCourse = async (course: CourseItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager kurslarni boshqara oladi.");
      return;
    }

    const nextName = (courseEditName[course.id] ?? course.name).trim();
    const nextCategory = courseEditCategory[course.id] ?? course.category;
    const hasStartEdit = Object.prototype.hasOwnProperty.call(courseEditStartDate, course.id);
    const hasEndEdit = Object.prototype.hasOwnProperty.call(courseEditEndDate, course.id);
    const nextStartDate = hasStartEdit ? courseEditStartDate[course.id] : toDateInputValue(course.startDate);
    const nextEndDate = hasEndEdit ? courseEditEndDate[course.id] : toDateInputValue(course.endDate);
    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        name: nextName,
        category: nextCategory,
        startDate: nextStartDate || null,
        endDate: nextEndDate || null,
      });
      setSuccess('Kurs yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Kursni yangilashda xatolik.');
    }
  };
  const handleToggleCourse = async (course: CourseItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager kurslarni boshqara oladi.");
      return;
    }

    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        isActive: !course.isActive,
      });
      setSuccess('Kurs holati yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Kurs holatini yangilashda xatolik.');
    }
  };
  const handleToggleCourseIncomeVisibility = async (course: CourseItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager kurslarni boshqara oladi.");
      return;
    }

    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        isHiddenFromIncomeForm: !course.isHiddenFromIncomeForm,
      });
      setSuccess(
        course.isHiddenFromIncomeForm
          ? "Kurs yangi to'lov tanlovida qayta ko'rsatiladi."
          : "Kurs yangi to'lov tanlovidan yashirildi.",
      );
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Kurs to'lov ko'rinishini yangilashda xatolik.");
    }
  };
  const handleUpdateTariff = async (tariff: TariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager tariflarni boshqara oladi.");
      return;
    }

    const nextName = (tariffEditName[tariff.id] ?? tariff.name).trim();
    try {
      await updateTariff.mutateAsync({
        tariffId: tariff.id,
        name: nextName,
      });
      setSuccess('Tarif yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Tarifni yangilashda xatolik.');
    }
  };
  const handleToggleTariff = async (tariff: TariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager tariflarni boshqara oladi.");
      return;
    }

    try {
      await updateTariff.mutateAsync({
        tariffId: tariff.id,
        isActive: !tariff.isActive,
      });
      setSuccess('Tarif holati yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Tarif holatini yangilashda xatolik.');
    }
  };
  const handleCreateSubTariff = async (tariffId: string) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager sub-tariflarni boshqara oladi.");
      return;
    }

    const name = (newSubTariffName[tariffId] || '').trim();
    if (!name) {
      setError('Sub-tarif nomi majburiy.');
      return;
    }

    try {
      await createSubTariff.mutateAsync({
        tariffId,
        name,
      });
      setNewSubTariffName((prev) => ({ ...prev, [tariffId]: '' }));
      setShowSubTariffForm((prev) => ({ ...prev, [tariffId]: false }));
      setSuccess('Sub-tarif muvaffaqiyatli saqlandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Sub-tarifni saqlashda xatolik.');
    }
  };
  const handleUpdateSubTariff = async (subTariff: SubTariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager sub-tariflarni boshqara oladi.");
      return;
    }

    const nextName = (subTariffEditName[subTariff.id] ?? subTariff.name).trim();
    try {
      await updateSubTariff.mutateAsync({
        subTariffId: subTariff.id,
        name: nextName,
      });
      setSuccess('Sub-tarif yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Sub-tarifni yangilashda xatolik.');
    }
  };
  const handleToggleSubTariff = async (subTariff: SubTariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError("Faqat admin yoki manager sub-tariflarni boshqara oladi.");
      return;
    }

    try {
      await updateSubTariff.mutateAsync({
        subTariffId: subTariff.id,
        isActive: !subTariff.isActive,
      });
      setSuccess('Sub-tarif holati yangilandi.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Sub-tarif holatini yangilashda xatolik.');
    }
  };

  return { user, canManageCourses, error, setError, success, setSuccess, newCourseName, setNewCourseName, newCourseCategory, setNewCourseCategory, newCourseStartDate, setNewCourseStartDate, newCourseEndDate, setNewCourseEndDate, selectedCourseId, setSelectedCourseId, newTariffName, setNewTariffName, newSubTariffName, setNewSubTariffName, courseEditName, setCourseEditName, courseEditCategory, setCourseEditCategory, courseEditStartDate, setCourseEditStartDate, courseEditEndDate, setCourseEditEndDate, tariffEditName, setTariffEditName, subTariffEditName, setSubTariffEditName, openCourseIds, setOchishCourseIds, openTariffIds, setOchishTariffIds, showSubTariffForm, setShowSubTariffForm, catalogQuery, createCourse, createTariff, updateCourse, updateTariff, createSubTariff, updateSubTariff, courses, groupedCourses, resetMessages, toggleCourseOchish, toggleTariffOchish, toggleSubTariffForm, handleCreateCourse, handleCreateTariff, handleUpdateCourse, handleToggleCourse, handleToggleCourseIncomeVisibility, handleUpdateTariff, handleToggleTariff, handleCreateSubTariff, handleUpdateSubTariff, handleToggleSubTariff };
}
