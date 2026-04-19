'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { COLORS } from '@/lib/colors';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      router.replace('/');
    } catch (err: unknown) {
      const apiErr = err as { status?: number; data?: { non_field_errors?: string[] } };
      if (!apiErr?.status) {
        setError('Could not reach the server. Is the backend running?');
      } else {
        setError(apiErr?.data?.non_field_errors?.[0] ?? 'Invalid username or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 style={{ color: COLORS.text, fontSize: 24, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>
        Sign in
      </h1>
      <p style={{ color: COLORS.textMuted, marginBottom: 28, fontSize: 14, marginTop: 0 }}>
        Welcome back to Exam Scheduler
      </p>

      {error && (
        <div style={{
          background: COLORS.redSoft,
          border: `1px solid ${COLORS.red}`,
          color: COLORS.red,
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={inputStyle}
          />
        </label>

        <div style={{ textAlign: 'right', marginTop: -8 }}>
          <Link href="/forgot-password" style={{ color: COLORS.accent, fontSize: 13 }}>
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: COLORS.textMuted }}>
        Don&apos;t have an account?{' '}
        <Link href="/signup" style={{ color: COLORS.accent }}>Sign up</Link>
      </p>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#0f1117',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '10px 12px',
  color: COLORS.text,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? COLORS.textMuted : COLORS.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '11px 0',
  fontSize: 15,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  marginTop: 4,
});
