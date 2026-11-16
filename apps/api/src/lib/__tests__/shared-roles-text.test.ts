import {
  groupDigits,
  isAgentOnly,
  isFinanceOnly,
  isTashkiliyOnly,
  normalizeSubTariffName,
  roleNeedsManagerMapping,
  sanitizeTelegramUsername,
} from '@dashboarduz/shared';

describe('shared role checks (were copied in the API and the web access guard)', () => {
  it('isAgentOnly', () => {
    expect(isAgentOnly(['OfflineAgent'])).toBe(true);
    expect(isAgentOnly(['Agent', 'TeamLeader'])).toBe(false);
  });

  it('isFinanceOnly', () => {
    expect(isFinanceOnly(['Finance', 'Dashboard'])).toBe(true);
    expect(isFinanceOnly(['Finance', 'Agent'])).toBe(false);
    expect(isFinanceOnly(['Finance', 'Manager'])).toBe(false);
  });

  it('isTashkiliyOnly', () => {
    expect(isTashkiliyOnly(['Tashkiliy'])).toBe(true);
    expect(isTashkiliyOnly(['Tashkiliy', 'Finance'])).toBe(false);
    expect(isTashkiliyOnly(['Tashkiliy', 'OnlineAgent'])).toBe(false);
  });

  it('roleNeedsManagerMapping covers agents and team leaders', () => {
    expect(['Agent', 'OnlineAgent', 'OfflineAgent', 'TeamLeader'].every(roleNeedsManagerMapping)).toBe(true);
    expect(roleNeedsManagerMapping('Manager')).toBe(false);
  });
});

describe('shared text helpers', () => {
  it('sanitizeTelegramUsername and normalizeSubTariffName', () => {
    expect(sanitizeTelegramUsername(' @user name! ')).toBe('@username');
    expect(normalizeSubTariffName('  VIP ')).toBe('vip');
  });

  it('groupDigits takes a separator (the group summary uses a plain space)', () => {
    expect(groupDigits('1234567', ' ')).toBe('1 234 567');
    expect(groupDigits('-1500', ' ')).toBe('-1 500');
  });
});
