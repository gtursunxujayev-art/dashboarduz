/**
 * The parts of AI provider response bodies this app reads: the OpenAI Responses API
 * (`output_text`, `output[].content[].text`), Chat Completions as served by DeepSeek
 * (`choices[0].message.content`), and the `error.message` both return on failure.
 * Values the providers document as strings are still typed `unknown` and checked before use.
 */
export type AiProviderBody = {
  error?: { message?: unknown } | null;
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown } | null> | null } | null> | null;
  choices?: Array<{ message?: { content?: unknown } | null } | null> | null;
} | null;

/** The JSON body of a provider response, or `{}` when it is not JSON. */
export async function readAiProviderBody(response: Response): Promise<AiProviderBody> {
  return await response.json().catch(() => ({})) as AiProviderBody;
}

/** `error.message` from a failed provider response, else `fallback`. */
export function aiProviderErrorText(body: AiProviderBody, fallback: string): string {
  return String(body?.error?.message || fallback);
}

/** Text of an OpenAI Responses API body: `output_text`, else every `output[].content[].text` joined by newlines. */
export function aiResponsesOutputText(body: AiProviderBody): string {
  if (typeof body?.output_text === 'string') {
    return body.output_text;
  }
  const parts: string[] = [];

  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') {
        parts.push(content.text);
      }
    }
  }

  return parts.join('\n').trim();
}

/** Text of the first Chat Completions choice, trimmed (`''` when there is none). */
export function aiChatCompletionText(body: AiProviderBody): string {
  return String(body?.choices?.[0]?.message?.content || '').trim();
}
