'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

type UserRole = 'Admin' | 'Manager' | 'Agent' | 'Finance' | 'Tashkiliy';

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
  
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: false, // We'll call it manually
    retry: false,
  });

  const refreshUser = async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      setIsLoading(false);
      return;
    }

    try {
      const response = await meQuery.refetch();
      if (response.data) {
        const nextUser = {
          userId: response.data.id,
          tenantId: response.data.tenantId,
          roles: response.data.roles as UserRole[],
          email: response.data.email || undefined,
          phone: response.data.phone || undefined,
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
      setUser(null);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
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
        await refreshUser();
      } else {
        setIsLoading(false);
      }
    })();
    // Run once on app bootstrap to avoid auth refresh loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
