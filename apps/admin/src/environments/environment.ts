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
}
