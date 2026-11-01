import type { ApiTypes } from "@clubspace/api-client"

import { apiBaseUrl } from "../lib/app-links"

// GET /public/legal: the current offer/DPA editions («YYYY-MM-DD», optionally
// suffixed; the date is the effective date), the days an owner has to accept
// a new edition, and the seller's requisites (null = not configured yet).
export type PublicLegal = ApiTypes.GetPublicLegalOutputOutput
export type SellerRequisites = PublicLegal["seller"]

// What the pages show when the API is unreachable: the server's defaults.
export const FALLBACK_ACCEPT_GRACE_DAYS = 14

// Server-side only. Plain fetch like public-clubs.ts; the editions and
// requisites change on a deploy, so five minutes of caching is plenty. Any
// failure is null: a legal page must render (with fallbacks) without the API.
const REVALIDATE_SECONDS = 300

export const getPublicLegal = async (): Promise<PublicLegal | null> => {
  try {
    const res = await fetch(`${apiBaseUrl()}/public/legal`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return null
    return (await res.json()) as PublicLegal
  } catch {
    return null
  }
}
