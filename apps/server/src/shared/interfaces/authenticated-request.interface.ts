import { IncomingMessage } from 'http'

import { CurrentUserPayload } from '../decorators/current-user.decorator'

/**
 * The request as the guards actually use it: Node's `IncomingMessage` plus the
 * routing fields Express populates and the `user` payload `AuthGuard` attaches.
 *
 * `getRequest<IncomingMessage>()` describes none of those, which is why the
 * guards reached for `as any` on every single access — including the writes
 * that install the caller's role. Casts in an authorization path are exactly
 * the ones worth not having: `as any` on the write means a wrong-shaped `user`
 * object would be a runtime surprise in the one place that decides access.
 */
export interface AuthenticatedRequest extends IncomingMessage {
    params?: Record<string, string | undefined>
    query?: Record<string, string | undefined>
    body?: Record<string, unknown> & { workspaceId?: string }
    /** Only present when Nest is bootstrapped with `rawBody: true`. */
    rawBody?: Buffer | string
    user?: CurrentUserPayload
}
