import {
  aiChatCompletionText,
  aiProviderErrorText,
  aiResponsesOutputText,
  readAiProviderBody,
} from '../provider-response';

describe('AI provider response bodies', () => {
  it('prefers output_text in a Responses API body', () => {
    expect(aiResponsesOutputText({ output_text: '{"summary":"ok"}', output: [{ content: [{ text: 'ignored' }] }] }))
      .toBe('{"summary":"ok"}');
  });

  it('joins the output content texts and skips non-text parts', () => {
    expect(aiResponsesOutputText({
      output: [
        { content: [{ text: '  first' }, { text: 42 }, null] },
        null,
        { content: null },
        { content: [{ text: 'second  ' }] },
      ],
    })).toBe('first\nsecond');
    expect(aiResponsesOutputText(null)).toBe('');
    expect(aiResponsesOutputText({})).toBe('');
  });

  it('reads the first chat completion choice', () => {
    expect(aiChatCompletionText({ choices: [{ message: { content: '  Javob  ' } }, { message: { content: 'other' } }] })).toBe('Javob');
    expect(aiChatCompletionText({ choices: [] })).toBe('');
    expect(aiChatCompletionText({ choices: [{ message: null }] })).toBe('');
    expect(aiChatCompletionText(null)).toBe('');
  });

  it('uses the provider error message, else the fallback', () => {
    expect(aiProviderErrorText({ error: { message: 'Insufficient balance' } }, 'DeepSeek failed')).toBe('Insufficient balance');
    expect(aiProviderErrorText({ error: { message: '' } }, 'DeepSeek failed')).toBe('DeepSeek failed');
    expect(aiProviderErrorText(null, 'OpenAI failed')).toBe('OpenAI failed');
  });

  it('reads a JSON body and falls back to {} for anything else', async () => {
    await expect(readAiProviderBody(new Response('{"output_text":"x"}'))).resolves.toEqual({ output_text: 'x' });
    await expect(readAiProviderBody(new Response('<html>Bad gateway</html>', { status: 502 }))).resolves.toEqual({});
  });
});
