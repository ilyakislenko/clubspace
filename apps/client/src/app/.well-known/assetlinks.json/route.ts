import { buildAssetLinks } from "../../../shared/lib/app-links"

// Android verifies App Links (autoVerify) against this file.
export const dynamic = "force-dynamic"

export function GET() {
  const body = buildAssetLinks()
  if (!body) {
    return new Response("Not configured", { status: 404 })
  }
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=3600" },
  })
}
