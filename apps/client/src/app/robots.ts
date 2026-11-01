import type { MetadataRoute } from "next"

import { readSiteLinks } from "../shared/lib/app-links"

// SITE_URL is read at request time, like the rest of this host's config.
export const dynamic = "force-dynamic"

/**
 * Closed-club instance: discourage all crawlers, except the landing at the
 * root ("/$" — the root only, not everything under it), the public legal
 * pages (privacy policy, account deletion) that store reviewers must reach,
 * and the club catalog with the pages of clubs that chose to be listed.
 * Join pages (/join/<code>) stay out: a code is a key to the club.
 */
export default function robots(): MetadataRoute.Robots {
  const { site } = readSiteLinks()
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/legal/", "/c/", "/clubs"],
        disallow: "/",
      },
    ],
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  }
}
