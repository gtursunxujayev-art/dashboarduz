import { TRPCError } from '@trpc/server';

import { resolveAiProvider } from '../../lib/ai-provider';
import { parseCustomDate } from '../../lib/dates';
import { chooseFocus, generateAssistantText, loadHelperPrompt } from '../../services/ai-helper/assistant';
import { buildCourseDirectAnswer, buildCourseHintSummary, buildCourseSuggestionAnswer, shouldPreferCourseDirectAnswer } from '../../services/ai-helper/course-hints';
import { resolveDateWindow } from '../../services/ai-helper/date-window';
import { aiHelperInputSchema } from '../../services/ai-helper/input';
import { protectedProcedure, router } from '../trpc';

import { collectAnalyticsInput } from './analytics-ai';

export const aiHelperRouter = router({
  chat: protectedProcedure
    .input(aiHelperInputSchema)
    .mutation(async ({ ctx, input }) => {
      const roles = ctx.user.roles || [];
      const allowed = roles.includes('Admin') || roles.includes('Manager');

      if (!allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'AI yordamchidan faqat Admin va Manager foydalanishi mumkin.' });
      }

      const now = new Date();
      const resolved = resolveDateWindow(input.message, input.pageContext, now);
      const rangeStart = parseCustomDate(resolved.dateFrom, false);
      const rangeEnd = parseCustomDate(resolved.dateTo, true);
      const focus = chooseFocus(input.message);
      const courseHint = await buildCourseHintSummary(ctx.tenantId, rangeStart, rangeEnd, input.message, ctx.db);

      if (courseHint && shouldPreferCourseDirectAnswer(input.message)) {
        if (courseHint.matchedCourseName && courseHint.similarity >= 0.55) {
          return {
            answer: buildCourseDirectAnswer(courseHint),
            provider: 'rule-based',
            model: 'local-course-resolver',
            resolvedDateWindow: resolved,
            focus,
          };
        }

        const suggestion = buildCourseSuggestionAnswer(courseHint);

        if (suggestion) {
          return {
            answer: suggestion,
            provider: 'rule-based',
            model: 'local-course-resolver',
            resolvedDateWindow: resolved,
            focus,
          };
        }
      }
      const analyticsInput = await collectAnalyticsInput(ctx.tenantId, rangeStart, rangeEnd, focus, ctx.db);
      const prompt = await loadHelperPrompt();
      const provider = resolveAiProvider();

      const payload = {
        tenantId: ctx.tenantId,
        currentUser: {
          userId: ctx.user.userId,
          roles,
        },
        pageContext: input.pageContext || null,
        resolvedDateWindow: resolved,
        analyticsInput,
        courseHint,
        readonlyPolicy: {
          dbAccess: 'read-only',
          projectMutationsAllowed: false,
          dataMutationsAllowed: false,
        },
      };

      const answer = await generateAssistantText(provider, prompt, payload, input.history, input.message);
      const trimmed = String(answer || '').trim();

      return {
        answer: trimmed || "Hozircha javob shakllantirib bo'lmadi.",
        provider: provider.provider,
        model: provider.model,
        resolvedDateWindow: resolved,
        focus,
      };
    }),
});
