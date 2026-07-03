'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);
const LIVE_LEADERBOARD_PATH = '/dashboard/live-leaderboard';
const OFFLINE_LEADERBOARD_PATH = '/dashboard/offline-leaderboard';
const AGENT_ALLOWED_PATHS = [
  '/dashboard',
  '/dashboard/leads',
  '/dashboard/calls',
  '/dashboard/corporate-calls',
  '/dashboard/income',
  '/dashboard/adjustments',
  '/dashboard/sotuvchilar',
  '/dashboard/customers',
  '/dashboard/finance',
];
const FINANCE_ALLOWED_PATHS = [
  '/dashboard',
  '/dashboard/adjustments',
  '/dashboard/attendance',
  '/dashboard/course-sales',
  '/dashboard/analytics',
  '/dashboard/finance',
];
const TASHKILIY_ALLOWED_PATHS = [
  '/dashboard',
  '/dashboard/adjustments',
  '/dashboard/attendance',
  '/dashboard/customers',
  '/dashboard/course-sales',
  '/dashboard/courses',
  '/dashboard/settings',
];
const MANAGER_BLOCKED_PATHS = [
  '/dashboard/integrations',
  '/dashboard/notifications',
  '/dashboard/income-problems',
  '/dashboard/income-debug',
];

function isAgentOnly(roles: string[]): boolean {
  return roles.some((role) => AGENT_ROLES.has(role)) && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function isFinanceOnly(roles: string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => (
    role === 'Admin'
    || role === 'Manager'
    || role === 'TeamLeader'
    || AGENT_ROLES.has(role)
  ));
}

function isManagerOnly(roles: string[]): boolean {
  return (roles.includes('Manager') || roles.includes('TeamLeader')) && !roles.includes('Admin');
}

function isTashkiliyOnly(roles: string[]): boolean {
  return roles.includes('Tashkiliy')
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('TeamLeader')
    && !roles.some((role) => AGENT_ROLES.has(role))
    && !roles.includes('Finance');
}

function isPathAllowed(pathname: string, allowedPaths: string[]): boolean {
  return allowedPaths.some((allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`));
}

function isPathBlocked(pathname: string, blockedPaths: string[]): boolean {
  return blockedPaths.some((blockedPath) => pathname === blockedPath || pathname.startsWith(`${blockedPath}/`));
}

function isOnlineDashboardOnly(roles: string[]): boolean {
  return roles.includes('Dashboard') && roles.every((role) => role === 'Dashboard');
}

function isOfflineDashboardOnly(roles: string[]): boolean {
  return roles.includes('OfflineDashboard') && roles.every((role) => role === 'OfflineDashboard');
}

export default function DashboardAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPath = pathname || '/dashboard';
  const isLeadPath = normalizedPath === '/dashboard/leads' || normalizedPath.startsWith('/dashboard/leads/');
  const canAccessLeads = Boolean(
    user?.roles?.includes('Admin')
    || user?.roles?.includes('Manager')
    || user?.roles?.includes('TeamLeader')
    || user?.roles?.some((role) => AGENT_ROLES.has(role)),
  );

  const isAgentRestriction = Boolean(user && isAgentOnly(user.roles));
  const isFinanceRestriction = Boolean(user && isFinanceOnly(user.roles));
  const isManagerRestriction = Boolean(user && isManagerOnly(user.roles));
  const isTashkiliyRestriction = Boolean(user && isTashkiliyOnly(user.roles));
  const isOnlineDashboardRestriction = Boolean(user && isOnlineDashboardOnly(user.roles));
  const isOfflineDashboardRestriction = Boolean(user && isOfflineDashboardOnly(user.roles));
  const restrictedDashboardPath = isOfflineDashboardRestriction
    ? OFFLINE_LEADERBOARD_PATH
    : LIVE_LEADERBOARD_PATH;

  const isAllowed = isOnlineDashboardRestriction || isOfflineDashboardRestriction
    ? normalizedPath === restrictedDashboardPath
    : isLeadPath
    ? canAccessLeads
    : isAgentRestriction
    ? isPathAllowed(normalizedPath, AGENT_ALLOWED_PATHS)
    : isFinanceRestriction
      ? isPathAllowed(normalizedPath, FINANCE_ALLOWED_PATHS)
      : isTashkiliyRestriction
        ? isPathAllowed(normalizedPath, TASHKILIY_ALLOWED_PATHS)
      : isManagerRestriction
        ? !isPathBlocked(normalizedPath, MANAGER_BLOCKED_PATHS)
        : true;

  useEffect(() => {
    if (!isLoading && user && (isOnlineDashboardRestriction || isOfflineDashboardRestriction) && normalizedPath === '/dashboard') {
      router.replace(restrictedDashboardPath);
      return;
    }
    if (!isLoading && !isAllowed) {
      if (isOnlineDashboardRestriction || isOfflineDashboardRestriction) {
        router.replace(restrictedDashboardPath);
        return;
      }
      router.replace('/dashboard');
    }
  }, [isLoading, isAllowed, isOfflineDashboardRestriction, isOnlineDashboardRestriction, normalizedPath, restrictedDashboardPath, router, user]);

  if (!isLoading && !isAllowed) {
    return null;
  }

  return <>{children}</>;
}

