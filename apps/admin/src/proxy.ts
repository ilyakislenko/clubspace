import { type NextRequest, NextResponse } from "next/server"

import { environment } from "./environments/environment"
import {
  buildContentSecurityPolicy,
  readMediaUrls,
} from "./shared/lib/content-security-policy"

// A fresh nonce and Content-Security-Policy for every page request. Next reads
// the nonce back from the request's CSP header and stamps it on its scripts;
// the root layout reads x-nonce for its own inline script. Pages therefore
// render per request (the root layout reads headers()) — a static page would
// carry no nonce and its scripts would be blocked. Same as
// apps/client/src/proxy.ts — keep the two in step.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const policy = buildContentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    apiUrl: environment.apiBaseUrl,
    mediaUrls: readMediaUrls(),
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  })

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", policy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", policy)
  return response
}

export const config = {
  matcher: [
    // Pages only: not API routes, build assets, the image optimizer or
    // public/ files, nor next/link prefetches (no HTML, so no scripts).
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|vendor/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
