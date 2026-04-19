'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { clearToken, getToken, setToken } from '@/lib/auth';
import { api } from '@/lib/api';

interface AuthUser {
  username: string;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string, password2: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USERNAME_KEY = 'exam_scheduler_username';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      const username = localStorage.getItem(USERNAME_KEY) ?? '';
      setUser({ token, username });
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const data = await api.post<{ token: string }>('/api/auth/token/', { username, password });
    setToken(data.token);
    localStorage.setItem(USERNAME_KEY, username);
    setUser({ token: data.token, username });
  };

  const signup = async (username: string, email: string, password: string, password2: string) => {
    await api.post('/api/auth/register/', { username, email, password, password2 });
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(USERNAME_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
