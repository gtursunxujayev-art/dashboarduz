'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export type DashboardAiPageContext = {
  pageKey: string;
  rangeMode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  filters?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  updatedAt?: string;
};

type DashboardAiContextState = {
  pageContext: DashboardAiPageContext | null;
  setPageContext: Dispatch<SetStateAction<DashboardAiPageContext | null>>;
};

const DashboardAiContext = createContext<DashboardAiContextState | null>(null);

export function DashboardAiContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<DashboardAiPageContext | null>(null);

  const value = useMemo<DashboardAiContextState>(
    () => ({
      pageContext,
      setPageContext,
    }),
    [pageContext],
  );

  return (
    <DashboardAiContext.Provider value={value}>
      {children}
    </DashboardAiContext.Provider>
  );
}

export function useDashboardAiContext() {
  const context = useContext(DashboardAiContext);
  if (!context) {
    throw new Error('useDashboardAiContext must be used within DashboardAiContextProvider');
  }
  return context;
}

export function useDashboardAiPageContext(value: DashboardAiPageContext | null) {
  const { setPageContext } = useDashboardAiContext();

  useEffect(() => {
    if (!value) {
      setPageContext(null);
      return;
    }
    setPageContext({
      ...value,
      updatedAt: value.updatedAt || new Date().toISOString(),
    });
    return () => {
      setPageContext((current) => (current?.pageKey === value.pageKey ? null : current));
    };
  }, [setPageContext, value]);
}
