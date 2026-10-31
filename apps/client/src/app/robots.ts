import type { MetadataRoute } from "next"

/**
 * Closed-club instance: discourage all crawlers, except the public legal
 * pages (privacy policy, account deletion) that store reviewers must reach,
 * and the club catalog with the pages of clubs that chose to be listed.
 * Join pages (/join/<code>) stay out: a code is a key to the club.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/legal/", "/c/", "/clubs"],
        disallow: "/",
      },
    ],
  }
}
