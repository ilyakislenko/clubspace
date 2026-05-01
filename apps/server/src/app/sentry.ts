import * as Sentry from '@sentry/node'

import { environment } from '../environments/environment'

let initialized = false

export const initSentry = (): boolean => {
    if (initialized) return true
    if (!environment.sentry.dsn) return false

    Sentry.init({
        dsn: environment.sentry.dsn,
        environment: environment.sentry.environment,
        tracesSampleRate: environment.sentry.tracesSampleRate,
    })

    initialized = true
    return true
}

export const captureException = (error: unknown) => {
    if (!initialized) return
    Sentry.captureException(error)
}
