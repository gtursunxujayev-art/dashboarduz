import { resolveAiProvider } from '../ai-provider';

describe('resolveAiProvider', () => {
  const keys = ['AI_PROVIDER', 'AI_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to OpenAI', () => {
    expect(resolveAiProvider()).toEqual({ provider: 'openai', apiKey: '', model: 'gpt-5.2' });
  });

  it('picks DeepSeek when only its key is set, or when asked explicitly', () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    expect(resolveAiProvider()).toEqual({ provider: 'deepseek', apiKey: 'k', model: 'deepseek-v4-pro' });
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_MODEL = 'm';
    expect(resolveAiProvider()).toEqual({ provider: 'openai', apiKey: '', model: 'm' });
    process.env.AI_PROVIDER = ' DeepSeek ';
    process.env.DEEPSEEK_MODEL = 'dm';
    expect(resolveAiProvider()).toEqual({ provider: 'deepseek', apiKey: 'k', model: 'dm' });
  });
});
