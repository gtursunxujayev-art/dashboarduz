import {
  prisma,
  TRPCError,
  z,
  asObject,
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  amocrmService,
  adminProcedure,
  protectedProcedure,
  collectCatalogFieldOptions,
  type LeadFieldOption,
} from './helpers';

export const settingsProcedures = {
  fieldOptions: adminProcedure.query(async ({ ctx }) => {
    const catalogOptions = await collectCatalogFieldOptions(ctx.tenantId);
    const merged = new Map<string, LeadFieldOption>();

    for (const option of getSystemLeadFieldOptions()) {
      merged.set(option.key, option);
    }

    for (const option of catalogOptions) {
      merged.set(option.key, option);
    }

    return {
      options: Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settings = asObject(tenant.settings);
    const dashboardSettings = asObject(settings?.dashboard);

    return {
      reasonFieldKey: typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null,
      sourceFieldKey: typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null,
      qualifiedStageIds: asStringArray(dashboardSettings?.qualifiedStageIds),
      qualifiedValues: asStringArray(dashboardSettings?.qualifiedValues),
      nonQualifiedValues: asStringArray(dashboardSettings?.nonQualifiedValues),
    };
  }),

  reasonValueOptions: adminProcedure
    .input(z.object({ fieldKey: z.string().optional(), pipelineIds: z.array(z.string()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!input?.fieldKey) {
        return { values: [] as string[] };
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        return { values: [] as string[] };
      }

      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext.selectedPipelineIds || null);

      const values = new Set<string>();
      let page = 1;
      let stagnantPages = 0;
      const maxPages = 40;

      while (page <= maxPages) {
        const response = await amocrmService.fetchLeads(
          amoContext.accessToken,
          '',
          {
            page,
            limit: 250,
            pipelineIds: selectedPipelineIds || undefined,
          },
          amoContext.baseUrl,
        );

        const leads = Array.isArray(response._embedded?.leads) ? response._embedded.leads : [];
        const sizeBefore = values.size;

        for (const lead of leads) {
          const value = extractLeadValue(lead, input.fieldKey);
          if (value) {
            values.add(value);
          }
        }

        if (values.size === sizeBefore) {
          stagnantPages += 1;
        } else {
          stagnantPages = 0;
        }

        const hasNext = Boolean(response._links?.next?.href);
        if (!hasNext || stagnantPages >= 5) {
          break;
        }

        page += 1;
      }

      return {
        values: Array.from(values).sort((a, b) => a.localeCompare(b)),
      };
    }),
};
