'use client';

import { AmoCallsSourcePanel } from '@/components/dashboard/amo-calls-source-panel';
import LoadingBlock from '@/components/dashboard/loading-block';
import type { IntegrationCardModel } from './use-integration-card';

export function AmoCrmPanel({ vm }: { vm: IntegrationCardModel }) {
  const { amoPipelinesQuery, handleSavePipelines, isAmoActive, loading, pipelines, pipelinesErrorMessage, selectedPipelineIds, setSelectedPipelineIds } = vm;

  return (
    <>
      {isAmoActive && (
        <div className="mt-4 rounded-md border border-blue-100 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Jonli o'qishda ishlatiladigan pipeline'lar</p>
              <p className="text-xs text-gray-500">
                Boshqaruv tahlili va webhook orqali qabul qilishda faqat belgilangan pipeline'lar ishlatiladi.
              </p>
            </div>
            <span className="text-xs text-gray-500">
              {selectedPipelineIds.length}/{pipelines.length} ta tanlangan
            </span>
          </div>

          {amoPipelinesQuery.isLoading ? (
            <LoadingBlock className="mt-3" compact message="Pipeline'lar yuklanmoqda..." />
          ) : pipelinesErrorMessage ? (
            <div className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{pipelinesErrorMessage}</p>
              <button
                type="button"
                onClick={() => amoPipelinesQuery.refetch()}
                disabled={amoPipelinesQuery.isFetching}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {amoPipelinesQuery.isFetching ? 'Qayta urinilmoqda...' : 'Qayta urinish'}
              </button>
            </div>
          ) : pipelines.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">AmoCRM dan pipeline ma'lumoti kelmadi.</p>
          ) : (
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {pipelines.map((pipeline) => (
                <label key={pipeline.id} className="flex items-start gap-3 rounded-md border border-gray-100 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedPipelineIds.includes(pipeline.id)}
                    onChange={(event) => {
                      setSelectedPipelineIds((current) => {
                        if (event.target.checked) {
                          return Array.from(new Set([...current, pipeline.id]));
                        }
                        return current.filter((id) => id !== pipeline.id);
                      });
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{pipeline.name}</p>
                    {Array.isArray(pipeline.statuses) && pipeline.statuses.length > 0 && (
                      <p className="text-xs text-gray-500">
                        Bosqichlar: {pipeline.statuses.map((status) => status.name).join(', ')}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={handleSavePipelines}
              disabled={loading || amoPipelinesQuery.isLoading || !!pipelinesErrorMessage}
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Saqlanmoqda...' : "Pipeline tanlovini saqlash"}
            </button>
          </div>
        </div>
      )}

      {isAmoActive && <AmoCallsSourcePanel />}
    </>
  );
}
