import { buildAppleAppSiteAssociation } from "../../../shared/lib/app-links"

// iOS fetches this (through Apple's CDN) to let the app open /join/* links.
// Served without an extension, as application/json, with no redirect.
export const dynamic = "force-dynamic"

export function GET() {
  const body = buildAppleAppSiteAssociation()
  if (!body) {
    return new Response("Not configured", { status: 404 })
  }
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=3600" },
  })
}
