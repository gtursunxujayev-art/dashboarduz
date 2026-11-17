'use client';

import { IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { AmoCallsSourcePanel } from '@/components/dashboard/amo-calls-source-panel';
import LoadingBlock from '@/components/dashboard/loading-block';
import type { IntegrationCardModel } from './use-integration-card';

export function AmoCrmPanel({ vm }: { vm: IntegrationCardModel }) {
  const { amoPipelinesQuery, handleSavePipelines, isAmoActive, loading, pipelines, pipelinesErrorMessage, selectedPipelineIds, setSelectedPipelineIds } = vm;

  return (
    <>
      {isAmoActive && (
        <section>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Jonli o'qishda ishlatiladigan pipeline'lar</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Boshqaruv tahlili va webhook orqali qabul qilishda faqat belgilangan pipeline'lar ishlatiladi.
              </p>
            </div>
            <span className="badge badge-neutral tabular">
              {selectedPipelineIds.length}/{pipelines.length} ta tanlangan
            </span>
          </div>

          {amoPipelinesQuery.isLoading ? (
            <LoadingBlock className="mt-3" compact message="Pipeline'lar yuklanmoqda..." />
          ) : pipelinesErrorMessage ? (
            <div className="alert alert-error mt-3 space-y-2">
              <p>{pipelinesErrorMessage}</p>
              <button
                type="button"
                onClick={() => amoPipelinesQuery.refetch()}
                disabled={amoPipelinesQuery.isFetching}
                className="btn btn-danger-soft btn-sm"
              >
                <IconRefresh className="h-4 w-4" stroke={1.8} />
                {amoPipelinesQuery.isFetching ? 'Qayta urinilmoqda...' : 'Qayta urinish'}
              </button>
            </div>
          ) : pipelines.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">AmoCRM dan pipeline ma'lumoti kelmadi.</p>
          ) : (
            <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
              {pipelines.map((pipeline) => {
                const checked = selectedPipelineIds.includes(pipeline.id);
                return (
                  <label
                    key={pipeline.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-2.5 text-sm text-gray-700 hover:border-gray-300 ${checked ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedPipelineIds((current) => {
                          if (event.target.checked) {
                            return Array.from(new Set([...current, pipeline.id]));
                          }
                          return current.filter((id) => id !== pipeline.id);
                        });
                      }}
                      className="checkbox mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{pipeline.name}</p>
                      {Array.isArray(pipeline.statuses) && pipeline.statuses.length > 0 && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          Bosqichlar: {pipeline.statuses.map((status) => status.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleSavePipelines}
              disabled={loading || amoPipelinesQuery.isLoading || !!pipelinesErrorMessage}
              className="btn btn-soft"
            >
              <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
              {loading ? 'Saqlanmoqda...' : "Pipeline tanlovini saqlash"}
            </button>
          </div>
        </section>
      )}

      {isAmoActive && <AmoCallsSourcePanel />}
    </>
  );
}
