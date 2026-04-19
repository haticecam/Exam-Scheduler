import React from 'react';
import { COLORS } from '@/lib/colors';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.bg,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '40px 32px',
          background: COLORS.surface,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
