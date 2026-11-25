import type { ApiTypes } from "@clubspace/api-client"

import { apiBaseUrl } from "../lib/app-links"
import { getApiClient } from "./client"

export type PublicTrialForm = ApiTypes.PublicTrialFormOutputOutput
export type PublicTrialRequestPayload = ApiTypes.CreatePublicTrialRequestInput

// Server-side only, like public-clubs.ts: plain fetch through Next's data
// cache (a QR poster sends a gym's worth of phones here at once). Null = the
// club does not take requests (unknown slug, form off, no operator) — the
// API answers 404 for all of them.
const REVALIDATE_SECONDS = 60

export const getPublicTrialForm = async (
  slug: string,
): Promise<PublicTrialForm | null> => {
  const path = `/public/clubs/${encodeURIComponent(slug)}/trial`
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { Accept: "application/json" },
  })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`)
  return (await res.json()) as PublicTrialForm
}

// From the browser, so the API's per-IP throttle counts the visitor.
export const createPublicTrialRequest = async (
  slug: string,
  payload: PublicTrialRequestPayload,
) =>
  await getApiClient().request<
    ApiTypes.CreatePublicTrialRequestOutputOutput,
    PublicTrialRequestPayload
  >({
    method: "post",
    url: `/public/clubs/${encodeURIComponent(slug)}/trial`,
    data: payload,
  })
