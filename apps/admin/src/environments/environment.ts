import { resolvePublicAppUrl } from "../shared/lib/public-app-url"

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"

export const environment = {
  apiBaseUrl,
  minioBucket: process.env.NEXT_PUBLIC_MINIO_BUCKET ?? "clubspace",
  // The public web app (legal pages). Optional override; derived from an
  // api.<domain> API address otherwise, null when it can't be.
  publicAppUrl: resolvePublicAppUrl({
    explicit: process.env.NEXT_PUBLIC_APP_URL,
    apiBaseUrl,
  }),
  // Same inbox the landing shows (apps/client reads the same variable).
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || null,
  // Where the video guides and their guides.json live (a public storage
  // prefix, baked in at build time). null: the «?» panel shows text only.
  guidesBaseUrl:
    process.env.NEXT_PUBLIC_GUIDES_BASE_URL?.trim().replace(/\/+$/, "") || null,
}
