'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { COLORS } from '@/lib/colors';

type Step = 'request' | 'confirm' | 'done';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [uid, setUid] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ uid?: string; token?: string }>('/api/auth/password-reset/', { email });
      if (data.uid && data.token) {
        setUid(data.uid);
        setToken(data.token);
      }
      setStep('confirm');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/password-reset/confirm/', { uid, token, new_password: newPassword });
      setStep('done');
    } catch (err: unknown) {
      const apiErr = err as { data?: { detail?: string } };
      setError(apiErr?.data?.detail ?? 'Invalid or expired reset link.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <>
        <h1 style={{ color: COLORS.text, fontSize: 24, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>
          Password updated
        </h1>
        <p style={{ color: COLORS.textMuted, marginBottom: 24, fontSize: 14 }}>
          Your password has been changed successfully.
        </p>
        <Link href="/login" style={{ color: COLORS.accent, fontSize: 14 }}>
          Back to sign in →
        </Link>
      </>
    );
  }

  if (step === 'confirm') {
    return (
      <>
        <h1 style={{ color: COLORS.text, fontSize: 24, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>
          Set new password
        </h1>
        <p style={{ color: COLORS.textMuted, marginBottom: 28, fontSize: 14, marginTop: 0 }}>
          Enter your new password below.
        </p>
        {error && <ErrorBox message={error} />}
        <form onSubmit={handleConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 13 }}>New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>
          <button type="submit" disabled={loading} style={buttonStyle(loading)}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 style={{ color: COLORS.text, fontSize: 24, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>
        Forgot password?
      </h1>
      <p style={{ color: COLORS.textMuted, marginBottom: 28, fontSize: 14, marginTop: 0 }}>
        Enter your email and we&apos;ll send you a reset link.
      </p>
      {error && <ErrorBox message={error} />}
      <form onSubmit={handleRequest} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: COLORS.textMuted }}>
        <Link href="/login" style={{ color: COLORS.accent }}>← Back to sign in</Link>
      </p>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      background: COLORS.redSoft,
      border: `1px solid ${COLORS.red}`,
      color: COLORS.red,
      borderRadius: 6,
      padding: '10px 14px',
      marginBottom: 16,
      fontSize: 14,
    }}>
      {message}
    </div>
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
