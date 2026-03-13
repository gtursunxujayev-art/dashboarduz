'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import type { JWTPayload } from '@dashboarduz/shared';

interface AuthContextType {
  user: JWTPayload | null;
  isLoading: boolean;
  login: (token: string, userData: JWTPayload) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<JWTPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: false, // We'll call it manually
    retry: false,
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser();
    } else {
      setIsLoading(false);
    }
  }, []);

  const refreshUser = async () => {
    try {
      const data = await meQuery.refetch();
      if (data.data) {
        setUser({
          userId: data.data.id,
          tenantId: data.data.tenantId,
          roles: data.data.roles as any,
          email: data.data.email || undefined,
          phone: data.data.phone || undefined,
        });
      } else {
        // No user data, clear auth
        logout();
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      logout();
    } finally {
      setIsLoading(false);
    }
  };

  const login = (token: string, userData: JWTPayload) => {
    localStorage.setItem('token', token);
    setUser(userData);
    router.push('/dashboard');
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
