import { type NextRequest, NextResponse } from "next/server"

import { environment } from "./environments/environment"
import {
  buildContentSecurityPolicy,
  readMediaUrls,
} from "./shared/lib/content-security-policy"
import { readMarketingConfig } from "./shared/lib/marketing"

// A fresh nonce and Content-Security-Policy for every page request. Next reads
// the nonce back from the request's CSP header and stamps it on its scripts;
// the landing reads x-nonce for the Metrika snippet. Pages therefore render
// per request (the root layout is force-dynamic) — a static page would carry
// no nonce and its scripts would be blocked. Same as apps/admin/src/proxy.ts
// — keep the two in step.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const policy = buildContentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    apiUrl: environment.apiBaseUrl,
    mediaUrls: readMediaUrls(),
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    metrika: readMarketingConfig().metrikaId !== null,
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
    // Pages only: not build assets, the image optimizer, public/ files or the
    // metadata routes, nor next/link prefetches (no HTML, so no scripts).
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|vendor/|robots.txt|sitemap.xml|opengraph-image|\\.well-known).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
