import type { ApiTypes } from "@clubspace/api-client"

import { apiBaseUrl } from "../lib/app-links"

export type PublicClub = ApiTypes.PublicClubOutputDtoOutput
export type PublicClubSearch = ApiTypes.SearchPublicClubsOutputDtoOutput
export type PublicClubSearchQuery = {
  q?: string
  city?: string
  type?: string
  curPage?: number
}

// Server-side only (these pages render on the server). Plain fetch rather than
// the axios client: no tokens, and Next's data cache collapses a gym full of
// people opening the same poster link into one API call a minute.
const REVALIDATE_SECONDS = 60

const getJson = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { Accept: "application/json" },
  })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) {
    throw new Error(`GET ${path} failed with ${res.status}`)
  }
  return (await res.json()) as T
}

export const getPublicClubByCode = (code: string) =>
  getJson<PublicClub>(`/public/clubs/by-code/${encodeURIComponent(code)}`)

export const getPublicClubBySlug = (slug: string) =>
  getJson<PublicClub>(`/public/clubs/${encodeURIComponent(slug)}`)

export const searchPublicClubs = async (
  query: PublicClubSearchQuery,
): Promise<PublicClubSearch> => {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.city) params.set("city", query.city)
  if (query.type) params.set("type", query.type)
  if (query.curPage && query.curPage > 1) {
    params.set("curPage", String(query.curPage))
  }
  const qs = params.toString()
  const result = await getJson<PublicClubSearch>(
    `/public/clubs${qs ? `?${qs}` : ""}`,
  )
  return (
    result ?? { data: [], total: 0, curPage: 1, perPage: 20, cities: [] }
  )
}
