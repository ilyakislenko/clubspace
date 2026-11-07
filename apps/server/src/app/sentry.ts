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
        release: environment.sentry.release,
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

// A crash reported by a client without its own SDK (POST /client-errors).
// Grouped by message; the client's stack rides along as extra context.
export const captureClientError = (report: {
    message: string
    stack?: string
    platform: string
    appVersion: string
    route?: string
    fatal?: boolean
}) => {
    if (!initialized) return
    Sentry.withScope((scope) => {
        scope.setTag('source', 'client')
        scope.setTag('platform', report.platform)
        scope.setTag('appVersion', report.appVersion)
        if (report.route) scope.setTag('route', report.route)
        scope.setLevel(report.fatal ? 'fatal' : 'error')
        if (report.stack) scope.setExtra('stack', report.stack)
        Sentry.captureMessage(report.message)
    })
}
