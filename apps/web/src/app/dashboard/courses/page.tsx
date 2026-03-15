'use client';

import { FormEvent, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type TariffItem = {
  id: string;
  name: string;
  isActive: boolean;
  courseId: string;
};

type CourseItem = {
  id: string;
  name: string;
  isActive: boolean;
  tariffs: TariffItem[];
};

export default function CoursesPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles?.includes('Admin'));

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newCourseName, setNewCourseName] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [newTariffName, setNewTariffName] = useState('');
  const [courseEditName, setCourseEditName] = useState<Record<string, string>>({});
  const [tariffEditName, setTariffEditName] = useState<Record<string, string>>({});

  const catalogQuery = trpc.customerIncome.courseCatalog.useQuery(undefined, {
    retry: false,
  });
  const createCourse = trpc.customerIncome.createCourse.useMutation();
  const createTariff = trpc.customerIncome.createTariff.useMutation();
  const updateCourse = trpc.customerIncome.updateCourse.useMutation();
  const updateTariff = trpc.customerIncome.updateTariff.useMutation();

  const courses = useMemo<CourseItem[]>(() => {
    return (catalogQuery.data || []) as CourseItem[];
  }, [catalogQuery.data]);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleCreateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!isAdmin) {
      setError('Only admins can add or edit courses.');
      return;
    }

    const name = newCourseName.trim();
    if (!name) {
      setError('Course name is required.');
      return;
    }

    try {
      await createCourse.mutateAsync({ name });
      setNewCourseName('');
      setSuccess('Course saved successfully.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to save course.');
    }
  };

  const handleCreateTariff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!isAdmin) {
      setError('Only admins can add or edit tariffs.');
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
    if (!isAdmin) {
      setError('Only admins can add or edit courses.');
      return;
    }

    const nextName = (courseEditName[course.id] ?? course.name).trim();
    try {
      await updateCourse.mutateAsync({
        courseId: course.id,
        name: nextName,
      });
      setSuccess('Course updated.');
      await catalogQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to update course.');
    }
  };

  const handleToggleCourse = async (course: CourseItem) => {
    resetMessages();
    if (!isAdmin) {
      setError('Only admins can add or edit courses.');
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
    if (!isAdmin) {
      setError('Only admins can add or edit tariffs.');
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
    if (!isAdmin) {
      setError('Only admins can add or edit tariffs.');
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

  if (!isAdmin) {
    return (
      <div className="rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold text-gray-900">Kurslar</h1>
        <p className="mt-2 text-sm text-red-700">Only Admin can change course and tariff options.</p>
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

          <form onSubmit={handleCreateCourse} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={newCourseName}
              onChange={(event) => setNewCourseName(event.target.value)}
              placeholder="New course name"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
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
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
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
            <div className="space-y-4">
              {courses.map((course) => (
                <div key={course.id} className="rounded-md border border-gray-200 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <input
                      value={courseEditName[course.id] ?? course.name}
                      onChange={(event) =>
                        setCourseEditName((prev) => ({ ...prev, [course.id]: event.target.value }))
                      }
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
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

                  <div className="mt-3 space-y-2">
                    {course.tariffs.length === 0 ? (
                      <p className="text-sm text-gray-500">No tariffs attached.</p>
                    ) : (
                      course.tariffs.map((tariff) => (
                        <div key={tariff.id} className="grid grid-cols-1 gap-3 rounded-md bg-gray-50 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
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
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
