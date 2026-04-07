'use client';

import { FormEvent, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type TariffItem = {
  id: string;
  name: string;
  isActive: boolean;
  courseId: string;
  subTariffs: SubTariffItem[];
};

type SubTariffItem = {
  id: string;
  name: string;
  isActive: boolean;
  tariffId: string;
};

type CourseItem = {
  id: string;
  name: string;
  category: 'online' | 'offline' | 'intensive' | 'additional_service';
  startDate: Date | string | null;
  endDate: Date | string | null;
  isActive: boolean;
  isHiddenFromIncomeForm: boolean;
  tariffs: TariffItem[];
};

const COURSE_CATEGORY_OPTIONS: Array<{ value: CourseItem['category']; label: string }> = [
  { value: 'online', label: 'Onlayn' },
  { value: 'offline', label: 'Oflayn' },
  { value: 'intensive', label: 'Intensiv' },
  { value: 'additional_service', label: "Qo'shimcha xizmat" },
];

function getCategoryLabel(category: CourseItem['category']): string {
  return COURSE_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || category;
}

function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export default function CoursesPage() {
  const { user } = useAuth();
  const canManageCourses = Boolean(user?.roles?.includes('Admin') || user?.roles?.includes('Manager'));

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

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Kurslar</h1>
          <p className="mt-1 text-sm text-gray-500">Kurs qo'shing, tarif biriktiring va ularni tahrirlang.</p>
        </div>

        <div className="space-y-4 p-6">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
          {!canManageCourses && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Siz bu bo'limni ko'rishingiz mumkin, lekin kurs va tariflarni faqat admin yoki manager o'zgartiradi.
            </p>
          )}

          {canManageCourses && (
            <>
              <form onSubmit={handleCreateCourse} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_180px_180px_auto]">
                <input
                  value={newCourseName}
                  onChange={(event) => setNewCourseName(event.target.value)}
                  placeholder="Yangi kurs nomi"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <select
                  value={newCourseCategory}
                  onChange={(event) => setNewCourseCategory(event.target.value as CourseItem['category'])}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {COURSE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newCourseStartDate}
                  onChange={(event) => setNewCourseStartDate(event.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={newCourseEndDate}
                  onChange={(event) => setNewCourseEndDate(event.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={createCourse.isLoading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {createCourse.isLoading ? "Saqlanmoqda..." : "Kurs qo'shish"}
                </button>
              </form>

              <form onSubmit={handleCreateTariff} className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]">
                <select
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Kursni tanlang</option>
                  {groupedCourses.map((group) =>
                    group.courses.length > 0 ? (
                      <optgroup key={`group-select-${group.value}`} label={group.label}>
                        {group.courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null,
                  )}
                </select>
                <input
                  value={newTariffName}
                  onChange={(event) => setNewTariffName(event.target.value)}
                  placeholder="Yangi tarif nomi"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={createTariff.isLoading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {createTariff.isLoading ? "Saqlanmoqda..." : "Tarif qo'shish"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-medium text-gray-900">Kurslar katalogi</h2>
        </div>

        <div className="p-6">
          {catalogQuery.isLoading ? (
            <p className="text-sm text-gray-600">Kurslar yuklanmoqda...</p>
          ) : courses.length === 0 ? (
            <p className="text-sm text-gray-600">Hozircha kurslar yo'q.</p>
          ) : (
            <div className="space-y-5">
              {groupedCourses.map((group) => (
                <section key={`group-section-${group.value}`} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{group.label} kurslari</h3>
                  {group.courses.length === 0 ? (
                    <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                      Hozircha {group.label.toLowerCase()} kurslari yo'q.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {group.courses.map((course) => (
                        <div key={course.id} className="overflow-hidden rounded-md border border-gray-200">
                          <button
                            type="button"
                            onClick={() => toggleCourseOchish(course.id)}
                            className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
                          >
                            <div>
                              <p className="text-base font-medium text-gray-900">{course.name}</p>
                              <p className="text-xs text-gray-500">
                                {course.tariffs.length} ta tarif - {course.isActive ? 'Faol' : 'Faolsiz'} - {getCategoryLabel(course.category)} - {course.isHiddenFromIncomeForm ? "To'lovdan yashirilgan" : "To'lovda ko'rinadi"} - {toDateInputValue(course.startDate) || '-'} / {toDateInputValue(course.endDate) || '-'}
                              </p>
                            </div>
                            <span className="text-sm text-blue-600">{openCourseIds[course.id] ? 'Yopish' : 'Ochish'}</span>
                          </button>

                          {openCourseIds[course.id] && (
                            <div className="space-y-3 border-t border-gray-200 p-4">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_170px_170px_auto_auto_auto] md:items-center">
                                <input
                                  value={courseEditName[course.id] ?? course.name}
                                  onChange={(event) =>
                                    setCourseEditName((prev) => ({ ...prev, [course.id]: event.target.value }))
                                  }
                                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <select
                                  value={courseEditCategory[course.id] ?? course.category}
                                  onChange={(event) =>
                                    setCourseEditCategory((prev) => ({
                                      ...prev,
                                      [course.id]: event.target.value as CourseItem['category'],
                                    }))
                                  }
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  {COURSE_CATEGORY_OPTIONS.map((option) => (
                                    <option key={`edit-${course.id}-${option.value}`} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={courseEditStartDate[course.id] ?? toDateInputValue(course.startDate)}
                                  onChange={(event) =>
                                    setCourseEditStartDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                                  }
                                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <input
                                  type="date"
                                  value={courseEditEndDate[course.id] ?? toDateInputValue(course.endDate)}
                                  onChange={(event) =>
                                    setCourseEditEndDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                                  }
                                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCourse(course)}
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  Saqlash
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleCourse(course)}
                                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                                    course.isActive
                                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                                  }`}
                                >
                                  {course.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleCourseIncomeVisibility(course)}
                                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                                    course.isHiddenFromIncomeForm
                                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                  }`}
                                >
                                  {course.isHiddenFromIncomeForm ? "To'lovda ko'rsatish" : "To'lovdan yashirish"}
                                </button>
                              </div>

                              {course.tariffs.length === 0 ? (
                                <p className="text-sm text-gray-500">Tarif biriktirilmagan.</p>
                              ) : (
                                <div className="space-y-2">
                                  {course.tariffs.map((tariff) => (
                                    <div key={tariff.id} className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                                      <button
                                        type="button"
                                        onClick={() => toggleTariffOchish(tariff.id)}
                                        className="flex w-full items-center justify-between bg-white px-3 py-2 text-left hover:bg-gray-50"
                                      >
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">{tariff.name}</p>
                                          <p className="text-xs text-gray-500">
                                            {tariff.subTariffs?.length || 0} ta sub-tarif - {tariff.isActive ? 'Faol' : 'Faolsiz'}
                                          </p>
                                        </div>
                                        <span className="text-xs text-blue-600">{openTariffIds[tariff.id] ? 'Yopish' : 'Ochish'}</span>
                                      </button>

                                      {openTariffIds[tariff.id] && (
                                        <div className="space-y-3 border-t border-gray-200 p-3">
                                          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                                            <input
                                              value={tariffEditName[tariff.id] ?? tariff.name}
                                              onChange={(event) =>
                                                setTariffEditName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                              }
                                              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => handleUpdateTariff(tariff)}
                                              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                            >
                                              Saqlash
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleToggleTariff(tariff)}
                                              className={`rounded-md px-3 py-2 text-sm font-medium ${
                                                tariff.isActive
                                                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                                  : 'bg-green-100 text-green-700 hover:bg-green-200'
                                              }`}
                                            >
                                              {tariff.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                                            </button>
                                          </div>

                                          <div className="rounded-md border border-gray-200 bg-white p-3">
                                            <div className="mb-3 flex items-center justify-between">
                                              <p className="text-xs font-semibold uppercase text-gray-500">Sub-tariflar (ixtiyoriy)</p>
                                              <button
                                                type="button"
                                                onClick={() => toggleSubTariffForm(tariff.id)}
                                                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                                              >
                                                {showSubTariffForm[tariff.id] ? "Bekor qilish" : "Sub-tarif qo'shish"}
                                              </button>
                                            </div>

                                            {showSubTariffForm[tariff.id] && (
                                              <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                                                <input
                                                  value={newSubTariffName[tariff.id] || ''}
                                                  onChange={(event) =>
                                                    setNewSubTariffName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                                  }
                                                  placeholder="Yangi sub-tarif"
                                                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleCreateSubTariff(tariff.id)}
                                                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                                >
                                                  Sub-tarifni saqlash
                                                </button>
                                              </div>
                                            )}

                                            {tariff.subTariffs?.length ? (
                                              <div className="space-y-2">
                                                {tariff.subTariffs.map((subTariff) => (
                                                  <div key={subTariff.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
                                                    <input
                                                      value={subTariffEditName[subTariff.id] ?? subTariff.name}
                                                      onChange={(event) =>
                                                        setSubTariffEditName((prev) => ({ ...prev, [subTariff.id]: event.target.value }))
                                                      }
                                                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={() => handleUpdateSubTariff(subTariff)}
                                                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                    >
                                                      Saqlash
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleToggleSubTariff(subTariff)}
                                                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                                                        subTariff.isActive
                                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                                                      }`}
                                                    >
                                                      {subTariff.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="text-sm text-gray-500">Hozircha sub-tariflar yo'q.</p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


