import type { Response } from 'express'

import { environment } from '../../environments/environment'

// Cookie transport for the refresh token — the admin panel only. The admin
// opts in per request with `X-Token-Transport: cookie`; the refresh token then
// travels only in an HttpOnly cookie on the API domain and never in a body a
// script could read. Everyone else (mobile, PWA, student web app) keeps the
// token in the body exactly as before.
//
// Cookie mode needs both the header and an Origin equal to the admin's
// (ADMIN_URL). The app. and pwa. sites are in CORS_ORIGINS with credentials
// and on the same site, so SameSite=Lax would let their scripts send the
// admin's cookie; for them the header changes nothing — the cookie is neither
// read, set nor cleared. The custom header also forces a CORS preflight, so
// a page outside CORS_ORIGINS can't make the request at all.
export const TOKEN_TRANSPORT_HEADER = 'x-token-transport'

export const REFRESH_COOKIE_NAME = 'cs_refresh'

// Sent only to the routes that read it. One cookie per path: /refresh-token
// rotates it, /sign-out revokes its family. Clearing works from any route.
export const REFRESH_COOKIE_PATHS = ['/refresh-token', '/sign-out'] as const

// What a request says about its transport: the opt-in header and its Origin.
export interface TokenTransportRequest {
    transport: string | string[] | undefined
    origin: string | undefined
}

export const wantsCookieTransport = ({
    transport,
    origin,
}: TokenTransportRequest): boolean => {
    const optedIn = (Array.isArray(transport) ? transport : [transport]).some(
        (value) => value?.trim().toLowerCase() === 'cookie',
    )
    if (!optedIn || !origin || !environment.adminUrl) return false
    return origin === new URL(environment.adminUrl).origin
}

// The refresh cookie's value from a raw Cookie header. Several copies (the
// browser sends every cookie whose path matches) carry the same token; the
// first non-empty one wins.
export const readRefreshCookie = (
    cookieHeader: string | undefined,
): string | undefined => {
    if (!cookieHeader) return undefined
    for (const part of cookieHeader.split(';')) {
        const eq = part.indexOf('=')
        if (eq === -1) continue
        if (part.slice(0, eq).trim() !== REFRESH_COOKIE_NAME) continue
        const value = part.slice(eq + 1).trim()
        if (!value) continue
        try {
            return decodeURIComponent(value)
        } catch {
            // Malformed escape: not a token we issued.
            return undefined
        }
    }
    return undefined
}

const cookieOptions = (path: string) => ({
    httpOnly: true,
    // Local dev is plain http (admin :4200 → API :3000, same site).
    secure: environment.production,
    sameSite: 'lax' as const,
    path,
})

export const setRefreshCookie = (res: Response, refreshToken: string): void => {
    for (const path of REFRESH_COOKIE_PATHS) {
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
            ...cookieOptions(path),
            // Seconds in config, milliseconds here; dies with the token.
            maxAge: environment.jwt.refreshTokenTTL * 1000,
        })
    }
}

export const clearRefreshCookie = (res: Response): void => {
    for (const path of REFRESH_COOKIE_PATHS) {
        res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(path))
    }
}

// A freshly issued session as the transport wants it: in cookie mode the
// refresh token moves into the cookie and out of the body.
export const deliverSession = <T extends { refreshToken: string }>(
    res: Response,
    request: TokenTransportRequest,
    session: T,
): Omit<T, 'refreshToken'> & { refreshToken?: string } => {
    if (!wantsCookieTransport(request)) return session
    const { refreshToken, ...body } = session
    setRefreshCookie(res, refreshToken)
    return body
}
