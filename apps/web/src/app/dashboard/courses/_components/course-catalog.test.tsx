import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CourseCatalog } from './course-catalog';
import { type CourseItem, splitArchivedCourses } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

jest.mock('./course-edit-sheet', () => ({ CourseEditSheet: () => null }));

function course(id: string, name: string, category: CourseItem['category'], isActive: boolean): CourseItem {
  return { id, name, category, isActive, startDate: null, endDate: null, isHiddenFromIncomeForm: false, tariffs: [] };
}

const courses = [
  course('1', 'Online-Dekabr', 'online', true),
  course('2', 'Online-Aprel', 'online', false),
  course('3', 'Oflayn-Mart', 'offline', false),
  course('4', 'Intensiv-1', 'intensive', true),
];
const groups = [
  { value: 'online', label: 'Onlayn', courses: courses.filter((item) => item.category === 'online') },
  { value: 'offline', label: 'Oflayn', courses: courses.filter((item) => item.category === 'offline') },
  { value: 'intensive', label: 'Intensiv', courses: courses.filter((item) => item.category === 'intensive') },
];

describe('course archive', () => {
  it('keeps active courses in the catalog and moves inactive ones to the archive', () => {
    const { active, archived, archivedCount } = splitArchivedCourses(groups);

    expect(active.map((group) => group.courses.map((item) => item.name))).toEqual([['Online-Dekabr'], [], ['Intensiv-1']]);
    expect(archived.map((group) => [group.value, group.courses.map((item) => item.name)])).toEqual([
      ['online', ['Online-Aprel']],
      ['offline', ['Oflayn-Mart']],
    ]);
    expect(archivedCount).toBe(2);
  });

  it('shows the archive collapsed with a count and opens it on click', () => {
    const vm = {
      catalogQuery: { isLoading: false, error: null },
      courses,
      groupedCourses: groups,
      openCourseIds: {},
      toggleCourseOchish: jest.fn(),
    } as unknown as CoursesPageModel;

    render(<CourseCatalog vm={vm} />);

    expect(screen.getByText('Online-Dekabr')).toBeInTheDocument();
    expect(screen.queryByText('Online-Aprel')).toBeNull();
    const archive = screen.getByTestId('course-archive');
    const toggle = within(archive).getByRole('button', { name: /Arxiv/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(archive).getByText('2')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Online-Aprel')).toBeInTheDocument();
    expect(screen.getByText('Oflayn-Mart')).toBeInTheDocument();
  });
});
