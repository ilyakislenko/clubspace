import * as Sentry from '@sentry/node'

import { environment } from '../environments/environment'
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub'

let initialized = false

export const initSentry = (): boolean => {
    if (initialized) return true
    if (!environment.sentry.dsn) return false

    Sentry.init({
        dsn: environment.sentry.dsn,
        environment: environment.sentry.environment,
        tracesSampleRate: environment.sentry.tracesSampleRate,
        // No IPs, cookies or request bodies; whatever else reaches an event
        // is masked by scrubEvent (see sentry-scrub.ts).
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
    })

    initialized = true
    return true
}

export const captureException = (error: unknown) => {
    if (!initialized) return
    Sentry.captureException(error)
}
