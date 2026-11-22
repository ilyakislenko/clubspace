'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// The root layout itself failed, so nothing of it (styles, fonts) is
// available: own <html>/<body>, inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100svh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          Что-то пошло не так
        </h1>
        <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>
          Мы уже знаем об ошибке. Попробуйте ещё раз.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid currentColor',
            background: 'transparent',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Повторить
        </button>
      </body>
    </html>
  );
}
