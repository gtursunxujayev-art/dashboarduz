/** Which LLM API the AI helper and analytics AI use, from the environment. */
export type AiProviderConfig =
  | { provider: 'deepseek'; model: string; apiKey: string }
  | { provider: 'openai'; model: string; apiKey: string };

/**
 * DeepSeek when `AI_PROVIDER=deepseek`, or when `AI_PROVIDER` is unset and `DEEPSEEK_API_KEY` is set;
 * otherwise OpenAI. Models come from `DEEPSEEK_MODEL` / `OPENAI_MODEL`, then `AI_MODEL`, then a default.
 */
export function resolveAiProvider(): AiProviderConfig {
  const explicitProvider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();

  if (explicitProvider === 'deepseek' || (!explicitProvider && process.env.DEEPSEEK_API_KEY)) {
    return {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-pro',
    };
  }

  return {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-5.2',
  };
}
