'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

type UserRole = 'Admin' | 'Manager' | 'Agent';

interface JWTPayload {
  userId: string;
  tenantId: string;
  roles: UserRole[];
  email?: string;
  phone?: string;
}

interface AuthContextType {
  user: JWTPayload | null;
  isLoading: boolean;
  login: (token: string, userData: JWTPayload) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const TOKEN_STORAGE_KEY = 'token';
const USER_STORAGE_KEY = 'auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<JWTPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: false, // We'll call it manually
    retry: false,
  });

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      setIsLoading(false);
      return;
    }

    try {
      const data = await meQuery.refetch();
      if (data.data) {
        const nextUser = {
          userId: data.data.id,
          tenantId: data.data.tenantId,
          roles: data.data.roles as UserRole[],
          email: data.data.email || undefined,
          phone: data.data.phone || undefined,
        };
        setUser(nextUser);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
      } else {
        setUser(null);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      const cachedUser = localStorage.getItem(USER_STORAGE_KEY);
      if (!cachedUser) {
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [meQuery]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) {
      const cachedUser = localStorage.getItem(USER_STORAGE_KEY);
      if (cachedUser) {
        try {
          setUser(JSON.parse(cachedUser) as JWTPayload);
        } catch {
          localStorage.removeItem(USER_STORAGE_KEY);
        }
      }
      void refreshUser();
    } else {
      setIsLoading(false);
    }
  }, [refreshUser]);

  const login = (token: string, userData: JWTPayload) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    setUser(userData);
    router.push('/dashboard');
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    router.push('/auth/login');
  };

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (pathname === '/') {
      if (user) {
        router.replace('/dashboard');
      } else {
        router.replace('/auth/login');
      }
    }
  }, [isLoading, pathname, router, user]);

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
