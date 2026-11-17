import { toCourseOptions } from '../catalog';

describe('toCourseOptions', () => {
  const courses = [{
    id: 'c1',
    name: 'IELTS',
    category: 'online',
    tariffs: [{
      id: 't1',
      name: 'VIP',
      subTariffs: [{ id: 's1', name: 'A', isActive: true }, { id: 's2', name: 'B', isActive: false }],
    }, { id: 't2', name: 'Standart' }],
  }];

  it('keeps id, name, category and tariffs, dropping other fields', () => {
    expect(toCourseOptions(courses, { activeSubTariffsOnly: false })).toEqual([{
      id: 'c1',
      name: 'IELTS',
      category: 'online',
      tariffs: [
        { id: 't1', name: 'VIP', subTariffs: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }] },
        { id: 't2', name: 'Standart', subTariffs: [] },
      ],
    }]);
  });

  it('can leave out inactive sub-tariffs', () => {
    expect(toCourseOptions(courses, { activeSubTariffsOnly: true })[0]?.tariffs[0]?.subTariffs).toEqual([{ id: 's1', name: 'A' }]);
  });
});
