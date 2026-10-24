import type { MetadataRoute } from "next"

/**
 * Closed-club instance: discourage all crawlers, except the public legal
 * pages (privacy policy, account deletion) that store reviewers must reach.
 * Switch to a real allow-list (or remove this file) once we open up.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/legal/",
        disallow: "/",
      },
    ],
  }
}
