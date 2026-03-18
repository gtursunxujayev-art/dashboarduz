'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const AGENT_ALLOWED_PATHS = [
  '/dashboard',
  '/dashboard/calls',
  '/dashboard/income',
  '/dashboard/analytics',
  '/dashboard/finance',
];
const FINANCE_ALLOWED_PATHS = [
  '/dashboard',
  '/dashboard/analytics',
  '/dashboard/finance',
];
const MANAGER_BLOCKED_PATHS = [
  '/dashboard/integrations',
  '/dashboard/notifications',
];

function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function isFinanceOnly(roles: string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => role === 'Admin' || role === 'Manager' || role === 'Agent');
}

function isManagerOnly(roles: string[]): boolean {
  return roles.includes('Manager') && !roles.includes('Admin');
}

function isPathAllowed(pathname: string, allowedPaths: string[]): boolean {
  return allowedPaths.some((allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`));
}

function isPathBlocked(pathname: string, blockedPaths: string[]): boolean {
  return blockedPaths.some((blockedPath) => pathname === blockedPath || pathname.startsWith(`${blockedPath}/`));
}

export default function DashboardAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPath = pathname || '/dashboard';
  const isLeadPath = normalizedPath === '/dashboard/leads' || normalizedPath.startsWith('/dashboard/leads/');

  const isAgentRestriction = Boolean(user && isAgentOnly(user.roles));
  const isFinanceRestriction = Boolean(user && isFinanceOnly(user.roles));
  const isManagerRestriction = Boolean(user && isManagerOnly(user.roles));

  const isAllowed = isLeadPath
    ? false
    : isAgentRestriction
    ? isPathAllowed(normalizedPath, AGENT_ALLOWED_PATHS)
    : isFinanceRestriction
      ? isPathAllowed(normalizedPath, FINANCE_ALLOWED_PATHS)
      : isManagerRestriction
        ? !isPathBlocked(normalizedPath, MANAGER_BLOCKED_PATHS)
        : true;

  useEffect(() => {
    if (!isLoading && !isAllowed) {
      router.replace('/dashboard');
    }
  }, [isLoading, isAllowed, router]);

  if (!isLoading && !isAllowed) {
    return null;
  }

  return <>{children}</>;
}
