'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { Button } from '@clubspace/ui-kit/ui';

// A page that threw while rendering. The layout around it stays, so the
// person can retry or navigate away. Sentry.captureException is a no-op when
// NEXT_PUBLIC_SENTRY_DSN is empty (Sentry was never initialised).
export default function RouteError({
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
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Что-то пошло не так</h1>
      <p className="text-sm text-muted-foreground">
        Мы уже знаем об ошибке. Попробуйте ещё раз.
      </p>
      <Button onClick={reset}>Повторить</Button>
    </div>
  );
}
