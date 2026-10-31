import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs"

// Error reports may leave the country (152-ФЗ ч. 5 ст. 18) and are read by
// people who have no business seeing members' contacts, so nothing that
// identifies a person or opens a session is sent: request bodies, cookies and
// auth headers are dropped, and e-mails, phones and tokens inside any string
// are masked. The user is reported by id only. Same algorithm as
// apps/server/src/app/sentry-scrub.ts and apps/client/src/shared/lib/sentry-scrub.ts
// — keep the three in step.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// A JWT (three base64url parts) or a bearer credential.
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g
const BEARER_RE = /\bBearer\s+[\w.~+/=-]+/gi
// International or Russian-style phone numbers: +7 999 123-45-67, 8(999)1234567.
// Candidates must hold 10–15 digits, so dates and ids pass untouched.
const PHONE_RE = /(?<![\w-])\+?\d[\d\s().-]{8,}\d(?![\w-])/g
const maskPhone = (candidate: string): string => {
  const digits = candidate.replace(/\D/g, "").length
  return digits >= 10 && digits <= 15 ? "[phone]" : candidate
}

// Keys whose values are secrets or contact data whatever they look like:
// exact names, or names ending in one of the suffixes (refreshToken,
// x-api-secret, contactEmail). Compared lowercased without separators.
const SENSITIVE_KEYS: Record<string, true> = {
  authorization: true,
  cookie: true,
  cookies: true,
  setcookie: true,
  session: true,
  code: true,
  otp: true,
  signature: true,
  apikey: true,
}
const SENSITIVE_SUFFIXES = ["token", "secret", "password", "email", "phone"]

export const isSensitiveKey = (key: string): boolean => {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return (
    SENSITIVE_KEYS[k] === true || SENSITIVE_SUFFIXES.some((s) => k.endsWith(s))
  )
}

export const scrubString = (value: string): string =>
  value
    .replace(JWT_RE, "[token]")
    .replace(BEARER_RE, "Bearer [token]")
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, maskPhone)

const MAX_DEPTH = 8

/** Deep copy of `value` with sensitive keys dropped and strings masked. */
export const scrubValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return scrubString(value)
  if (value === null || typeof value !== "object") return value
  if (depth >= MAX_DEPTH) return "[truncated]"
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? "[filtered]" : scrubValue(v, depth + 1)
  }
  return out
}

// Query strings carry join codes, playback tokens and e-mails on some routes
// (the sign-in page itself takes ?email=).
const stripQuery = (url: string): string => url.split("?")[0]

export const scrubEvent = (event: ErrorEvent): ErrorEvent => {
  if (event.request) {
    const { url, method } = event.request
    event.request = {
      ...(url ? { url: scrubString(stripQuery(url)) } : {}),
      ...(method ? { method } : {}),
    }
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {}
  }
  if (event.message) event.message = scrubString(event.message)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value)
  }
  if (event.extra) {
    event.extra = scrubValue(event.extra) as ErrorEvent["extra"]
  }
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as ErrorEvent["contexts"]
  }
  if (event.tags) {
    event.tags = scrubValue(event.tags) as ErrorEvent["tags"]
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb)
  }
  return event
}

export const scrubBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => {
  const out: Breadcrumb = { ...breadcrumb }
  if (out.message) out.message = scrubString(out.message)
  if (out.data) {
    const data = scrubValue(out.data) as Record<string, unknown>
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") {
        data[key] = stripQuery(data[key] as string)
      }
    }
    out.data = data
  }
  return out
}
