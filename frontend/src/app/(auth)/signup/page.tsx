'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { COLORS } from '@/lib/colors';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ username: '', email: '', password: '', password2: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (form.password !== form.password2) {
      setErrors({ password2: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    try {
      await signup(form.username, form.email, form.password, form.password2);
      router.replace('/');
    } catch (err: unknown) {
      const apiErr = err as { data?: Record<string, string | string[]> };
      const flat: Record<string, string> = {};
      if (apiErr?.data) {
        for (const [k, v] of Object.entries(apiErr.data)) {
          flat[k] = Array.isArray(v) ? v[0] : v;
        }
      }
      setErrors(flat);
    } finally {
      setLoading(false);
    }
  };

  const field = (
    name: keyof typeof form,
    label: string,
    type = 'text',
    autoComplete: string = name,
  ) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{label}</span>
      <input
        type={type}
        value={form[name]}
        onChange={set(name)}
        required
        autoComplete={autoComplete}
        style={inputStyle}
      />
      {errors[name] && <span style={{ color: COLORS.red, fontSize: 12 }}>{errors[name]}</span>}
    </label>
  );

  return (
    <>
      <h1 style={{ color: COLORS.text, fontSize: 24, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>
        Create account
      </h1>
      <p style={{ color: COLORS.textMuted, marginBottom: 28, fontSize: 14, marginTop: 0 }}>
        Join Exam Scheduler
      </p>

      {errors.non_field_errors && (
        <div style={{
          background: COLORS.redSoft,
          border: `1px solid ${COLORS.red}`,
          color: COLORS.red,
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 14,
        }}>
          {errors.non_field_errors}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {field('username', 'Username', 'text', 'username')}
        {field('email', 'Email', 'email', 'email')}
        {field('password', 'Password', 'password', 'new-password')}
        {field('password2', 'Confirm password', 'password', 'new-password')}

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: COLORS.textMuted }}>
        Already have an account?{' '}
        <Link href="/login" style={{ color: COLORS.accent }}>Sign in</Link>
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
