import type { MetadataRoute } from "next"

import { readSiteLinks } from "../shared/lib/app-links"

// SITE_URL is read at request time, like the rest of this host's config.
export const dynamic = "force-dynamic"

// The indexable pages robots.ts allows. Club pages are reached from /clubs.
const PATHS: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/clubs", priority: 0.6 },
  { path: "/legal/privacy", priority: 0.2 },
  { path: "/legal/terms", priority: 0.2 },
  { path: "/legal/consent", priority: 0.1 },
]

// Sitemap URLs must be absolute: without SITE_URL there is nothing to list.
export default function sitemap(): MetadataRoute.Sitemap {
  const { site } = readSiteLinks()
  if (!site) return []
  return PATHS.map(({ path, priority }) => ({
    url: `${site}${path}`,
    priority,
  }))
}
