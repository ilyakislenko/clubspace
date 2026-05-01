import * as Sentry from "@sentry/nextjs"

export const register = () => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
  })
}

export const onRequestError = Sentry.captureRequestError
