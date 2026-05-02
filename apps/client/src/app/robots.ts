import type { MetadataRoute } from "next"

/**
 * Closed-club instance: discourage all crawlers.
 * Switch to a real allow-list (or remove this file) once we open up.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  }
}
