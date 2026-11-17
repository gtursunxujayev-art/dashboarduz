import type { DbClient } from '@dashboarduz/db';

import { readDashboardSettings } from '../../services/dashboard/dashboard-settings';
import { loadTenantSettings, saveTenantSettings, withSalarySettings } from '../tenant-settings';

describe('tenant settings helpers', () => {
  it('loadTenantSettings returns the settings or NOT_FOUND', async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ settings: { a: 1 } })
      .mockResolvedValueOnce(null);
    const db = { tenant: { findUnique } } as unknown as DbClient;

    await expect(loadTenantSettings(db, 't1')).resolves.toEqual({ a: 1 });
    await expect(loadTenantSettings(db, 't1')).rejects.toThrow('Tenant not found');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 't1' }, select: { settings: true } });
  });

  it('withSalarySettings merges into settings.salary and keeps the rest', () => {
    expect(withSalarySettings({ funnel: { x: 1 }, salary: { bonusMode: 'simple', fixedSalaries: [] } }, { fixedSalaries: [{ userId: 'u', amount: 5 }] }))
      .toEqual({ funnel: { x: 1 }, salary: { bonusMode: 'simple', fixedSalaries: [{ userId: 'u', amount: 5 }] } });
    expect(withSalarySettings(null, { a: 1 })).toEqual({ salary: { a: 1 } });
  });

  it('saveTenantSettings writes the settings and one audit row', async () => {
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({});
    const db = { tenant: { update }, auditLog: { create } } as unknown as DbClient;

    await saveTenantSettings({ db, tenantId: 't1', actorUserId: 'u1', settings: { a: 1 }, auditAction: 'kpi_settings_update' });
    await saveTenantSettings({ db, tenantId: 't1', actorUserId: 'u1', settings: {}, auditAction: 'x', auditResourceId: 'r', auditMetadata: { n: 2 } });

    expect(update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { settings: { a: 1 } } });
    expect(create.mock.calls[0][0]).toEqual({
      data: { tenantId: 't1', userId: 'u1', action: 'kpi_settings_update', resource: 'tenant_settings', resourceId: 't1' },
    });
    expect(create.mock.calls[1][0].data).toMatchObject({ resourceId: 'r', metadata: { n: 2 } });
  });

  it('readDashboardSettings reads string keys and string lists', () => {
    expect(readDashboardSettings({ dashboard: { reasonFieldKey: 'r', sourceFieldKey: 5, qualifiedStageIds: ['1', 2] } })).toEqual({
      reasonFieldKey: 'r',
      sourceFieldKey: null,
      qualifiedStageIds: ['1', '2'],
      qualifiedValues: [],
      nonQualifiedValues: [],
    });
  });
});
