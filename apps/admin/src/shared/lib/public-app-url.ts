// Address of the public web app (apps/client), home of the /legal/* pages.
//
// Explicit NEXT_PUBLIC_APP_URL wins. Otherwise it is derived from the API
// address the way the server derives APP_URL: production serves the API at
// api.<domain> and the public app at app.<domain>. null when neither works
// (a local API on localhost) — callers say so instead of linking nowhere.
export const resolvePublicAppUrl = (p: {
  explicit: string | undefined
  apiBaseUrl: string
}): string | null => {
  if (p.explicit) return p.explicit.replace(/\/+$/, "")

  let url: URL
  try {
    url = new URL(p.apiBaseUrl)
  } catch {
    return null
  }
  if (!url.hostname.startsWith("api.")) return null
  url.hostname = `app.${url.hostname.slice("api.".length)}`
  return url.origin
}
