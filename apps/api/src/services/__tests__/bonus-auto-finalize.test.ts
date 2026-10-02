import { prisma } from '@dashboarduz/db';
import * as engine from '../bonus-engine';
import { autoFinalizePreviousBonusMonth, getPreviousTashkentMonthStart } from '../bonus-auto-finalize';

describe('bonus auto-finalize', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('targets the previous Tashkent month, even in the first hours of the 1st', () => {
    // 00:30 on 1 October in Tashkent is still 30 September in UTC.
    expect(getPreviousTashkentMonthStart(new Date('2026-10-01T00:30:00+05:00')).toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(getPreviousTashkentMonthStart(new Date('2026-09-30T23:59:00+05:00')).toISOString()).toBe('2026-07-31T19:00:00.000Z');
  });

  it('finalizes only tenants that have not finalized last month, as the system user', async () => {
    jest.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{ id: 't1' }, { id: 't2' }] as never);
    jest.spyOn(prisma.bonusMonthSnapshot, 'findMany').mockResolvedValue([{ tenantId: 't2' }] as never);
    const finalize = jest.spyOn(engine, 'finalizeBonusMonth').mockResolvedValue({} as never);
    await expect(autoFinalizePreviousBonusMonth(new Date('2026-10-01T10:00:00+05:00'))).resolves.toBe(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({
      tenantId: 't1',
      month: new Date('2026-08-31T19:00:00.000Z'),
      userId: engine.SYSTEM_FINALIZER_USER_ID,
    });
  });
});
