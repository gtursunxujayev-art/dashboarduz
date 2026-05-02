'use client';

import type { ReactNode } from 'react';
import { DashboardAiContextProvider } from '@/contexts/dashboard-ai-context';
import DashboardAiHelperWidget from '@/components/dashboard/dashboard-ai-helper-widget';

export default function DashboardAiShell({ children }: { children: ReactNode }) {
  return (
    <DashboardAiContextProvider>
      {children}
      <DashboardAiHelperWidget />
    </DashboardAiContextProvider>
  );
}
