import * as Sentry from "@sentry/nextjs"

import { scrubBreadcrumb, scrubEvent } from "./src/shared/lib/sentry-scrub"

export const register = () => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
    // No IPs, cookies or request bodies; e-mails, phones and tokens masked (152-ФЗ).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
}

export const onRequestError = Sentry.captureRequestError
