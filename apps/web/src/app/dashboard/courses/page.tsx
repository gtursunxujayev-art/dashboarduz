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
  category: 'online' | 'offline' | 'intensive';
  isActive: boolean;
  tariffs: TariffItem[];
};

const COURSE_CATEGORY_OPTIONS: Array<{ value: CourseItem['category']; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'intensive', label: 'Intensive' },
];

function getCategoryLabel(category: CourseItem['category']): string {
  return COURSE_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || category;
}

export default function CoursesPage() {
  const { user } = useAuth();
  const canManageCourses = Boolean(user?.roles?.includes('Admin') || user?.roles?.includes('Manager'));

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCategory, setNewCourseCategory] = useState<CourseItem['category']>('offline');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [newTariffName, setNewTariffName] = useState('');
  const [newSubTariffName, setNewSubTariffName] = useState<Record<string, string>>({});
  const [courseEditName, setCourseEditName] = useState<Record<string, string>>({});
  const [courseEditCategory, setCourseEditCategory] = useState<Record<string, CourseItem['category']>>({});
  const [tariffEditName, setTariffEditName] = useState<Record<string, string>>({});
  const [subTariffEditName, setSubTariffEditName] = useState<Record<string, string>>({});
  const [openCourseIds, setOpenCourseIds] = useState<Record<string, boolean>>({});
  const [openTariffIds, setOpenTariffIds] = useState<Record<string, boolean>>({});
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
    return (catalogQuery.data || []) as CourseItem[];
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

  const toggleCourseOpen = (courseId: string) => {
    setOpenCourseIds((prev) => ({ [courseId]: !prev[courseId] }));
  };

  const toggleTariffOpen = (tariffId: string) => {
    setOpenTariffIds((prev) => ({ [tariffId]: !prev[tariffId] }));
  };

  const toggleSubTariffForm = (tariffId: string) => {
    setShowSubTariffForm((prev) => ({ ...prev, [tariffId]: !prev[tariffId] }));
  };

  const handleCreateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!canManageCourses) {
      setError('Only admin or manager can add or edit courses.');
      return;
    }

    const name = newCourseName.trim();
    if (!name) {
      setError('Course name is required.');
      return;
    }

    try {
      await createCourse.mutateAsync({ name, category: newCourseCategory });
      setNewCourseName('');
      setNewCourseCategory('offline');
      setSuccess('Course saved successfully.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to save course.');
    }
  };

  const handleCreateTariff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!canManageCourses) {
      setError('Only admin or manager can add or edit tariffs.');
      return;
    }

    const name = newTariffName.trim();
    if (!selectedCourseId) {
      setError('Select a course first.');
      return;
    }
    if (!name) {
      setError('Tariff name is required.');
      return;
    }

    try {
      await createTariff.mutateAsync({
        courseId: selectedCourseId,
        name,
      });
      setNewTariffName('');
      setSuccess('Tariff saved successfully.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to save tariff.');
    }
  };

  const handleUpdateCourse = async (course: CourseItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit courses.');
      return;
    }

    const nextName = (courseEditName[course.id] ?? course.name).trim();
    const nextCategory = courseEditCategory[course.id] ?? course.category;
    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        name: nextName,
        category: nextCategory,
      });
      setSuccess('Course updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update course.');
    }
  };

  const handleToggleCourse = async (course: CourseItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit courses.');
      return;
    }

    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        isActive: !course.isActive,
      });
      setSuccess('Course status updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update course status.');
    }
  };

  const handleUpdateTariff = async (tariff: TariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit tariffs.');
      return;
    }

    const nextName = (tariffEditName[tariff.id] ?? tariff.name).trim();
    try {
      await updateTariff.mutateAsync({
        tariffId: tariff.id,
        name: nextName,
      });
      setSuccess('Tariff updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update tariff.');
    }
  };

  const handleToggleTariff = async (tariff: TariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit tariffs.');
      return;
    }

    try {
      await updateTariff.mutateAsync({
        tariffId: tariff.id,
        isActive: !tariff.isActive,
      });
      setSuccess('Tariff status updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update tariff status.');
    }
  };

  const handleCreateSubTariff = async (tariffId: string) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit sub-tariffs.');
      return;
    }

    const name = (newSubTariffName[tariffId] || '').trim();
    if (!name) {
      setError('Sub-tariff name is required.');
      return;
    }

    try {
      await createSubTariff.mutateAsync({
        tariffId,
        name,
      });
      setNewSubTariffName((prev) => ({ ...prev, [tariffId]: '' }));
      setShowSubTariffForm((prev) => ({ ...prev, [tariffId]: false }));
      setSuccess('Sub-tariff saved successfully.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to save sub-tariff.');
    }
  };

  const handleUpdateSubTariff = async (subTariff: SubTariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit sub-tariffs.');
      return;
    }

    const nextName = (subTariffEditName[subTariff.id] ?? subTariff.name).trim();
    try {
      await updateSubTariff.mutateAsync({
        subTariffId: subTariff.id,
        name: nextName,
      });
      setSuccess('Sub-tariff updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update sub-tariff.');
    }
  };

  const handleToggleSubTariff = async (subTariff: SubTariffItem) => {
    resetMessages();
    if (!canManageCourses) {
      setError('Only admin or manager can add or edit sub-tariffs.');
      return;
    }

    try {
      await updateSubTariff.mutateAsync({
        subTariffId: subTariff.id,
        isActive: !subTariff.isActive,
      });
      setSuccess('Sub-tariff status updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update sub-tariff status.');
    }
  };

  if (!canManageCourses) {
    return (
      <div className="rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold text-gray-900">Kurslar</h1>
        <p className="mt-2 text-sm text-red-700">Only admin or manager can change course and tariff options.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Kurslar</h1>
          <p className="mt-1 text-sm text-gray-500">Add courses, attach tariffs, and edit both options.</p>
        </div>

        <div className="space-y-4 p-6">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <form onSubmit={handleCreateCourse} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
            <input
              value={newCourseName}
              onChange={(event) => setNewCourseName(event.target.value)}
              placeholder="New course name"
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
            <button
              type="submit"
              disabled={createCourse.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createCourse.isLoading ? 'Saving...' : 'Add Course'}
            </button>
          </form>

          <form onSubmit={handleCreateTariff} className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]">
            <select
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select course</option>
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
              placeholder="New tariff name"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={createTariff.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createTariff.isLoading ? 'Saving...' : 'Add Tariff'}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-medium text-gray-900">Course Catalog</h2>
        </div>

        <div className="p-6">
          {catalogQuery.isLoading ? (
            <p className="text-sm text-gray-600">Loading courses...</p>
          ) : courses.length === 0 ? (
            <p className="text-sm text-gray-600">No courses yet.</p>
          ) : (
            <div className="space-y-5">
              {groupedCourses.map((group) => (
                <section key={`group-section-${group.value}`} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{group.label} Courses</h3>
                  {group.courses.length === 0 ? (
                    <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                      No {group.label.toLowerCase()} courses yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {group.courses.map((course) => (
                        <div key={course.id} className="overflow-hidden rounded-md border border-gray-200">
                          <button
                            type="button"
                            onClick={() => toggleCourseOpen(course.id)}
                            className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
                          >
                            <div>
                              <p className="text-base font-medium text-gray-900">{course.name}</p>
                              <p className="text-xs text-gray-500">
                                {course.tariffs.length} tariff{course.tariffs.length === 1 ? '' : 's'} - {course.isActive ? 'Active' : 'Inactive'} - {getCategoryLabel(course.category)}
                              </p>
                            </div>
                            <span className="text-sm text-blue-600">{openCourseIds[course.id] ? 'Close' : 'Open'}</span>
                          </button>

                          {openCourseIds[course.id] && (
                            <div className="space-y-3 border-t border-gray-200 p-4">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto_auto] md:items-center">
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
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCourse(course)}
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  Save
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
                                  {course.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                              </div>

                              {course.tariffs.length === 0 ? (
                                <p className="text-sm text-gray-500">No tariffs attached.</p>
                              ) : (
                                <div className="space-y-2">
                                  {course.tariffs.map((tariff) => (
                                    <div key={tariff.id} className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                                      <button
                                        type="button"
                                        onClick={() => toggleTariffOpen(tariff.id)}
                                        className="flex w-full items-center justify-between bg-white px-3 py-2 text-left hover:bg-gray-50"
                                      >
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">{tariff.name}</p>
                                          <p className="text-xs text-gray-500">
                                            {tariff.subTariffs?.length || 0} sub tariff{(tariff.subTariffs?.length || 0) === 1 ? '' : 's'} - {tariff.isActive ? 'Active' : 'Inactive'}
                                          </p>
                                        </div>
                                        <span className="text-xs text-blue-600">{openTariffIds[tariff.id] ? 'Close' : 'Open'}</span>
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
                                              Save
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
                                              {tariff.isActive ? 'Deactivate' : 'Activate'}
                                            </button>
                                          </div>

                                          <div className="rounded-md border border-gray-200 bg-white p-3">
                                            <div className="mb-3 flex items-center justify-between">
                                              <p className="text-xs font-semibold uppercase text-gray-500">Sub Tariffs (Optional)</p>
                                              <button
                                                type="button"
                                                onClick={() => toggleSubTariffForm(tariff.id)}
                                                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                                              >
                                                {showSubTariffForm[tariff.id] ? 'Cancel' : 'Add Sub Tariff'}
                                              </button>
                                            </div>

                                            {showSubTariffForm[tariff.id] && (
                                              <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                                                <input
                                                  value={newSubTariffName[tariff.id] || ''}
                                                  onChange={(event) =>
                                                    setNewSubTariffName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                                  }
                                                  placeholder="Add sub tariff"
                                                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleCreateSubTariff(tariff.id)}
                                                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                                >
                                                  Save Sub Tariff
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
                                                      Save
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
                                                      {subTariff.isActive ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="text-sm text-gray-500">No sub tariffs yet.</p>
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
