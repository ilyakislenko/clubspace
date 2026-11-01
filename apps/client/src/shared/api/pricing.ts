import type { ApiTypes } from "@clubspace/api-client"

import { apiBaseUrl } from "../lib/app-links"
import { getApiClient } from "./client"

export type PublicPricing = ApiTypes.GetPublicPricingOutputOutput
export type PricingModuleCode = PublicPricing["modules"][number]["code"]
export type PricingQuoteBody = ApiTypes.QuotePublicPricingInputDto
export type PricingQuote = ApiTypes.QuotePublicPricingOutputOutput
export type SelfServeConfig = ApiTypes.GetSelfServeConfigOutputOutput

// The landing renders on the server; prices change only with the server's
// config, so a few minutes of Next's data cache is plenty and keeps the page
// from calling the API on every visit.
const REVALIDATE_SECONDS = 300

const getJson = async <T>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    // The API is down: the landing still renders, without prices.
    return null
  }
}

// Server-side only.
export const getPublicPricing = () => getJson<PublicPricing>("/public/pricing")

// Server-side only. Whether the admin's /sign-up wizard is open.
export const getSelfServeConfig = () =>
  getJson<SelfServeConfig>("/self-serve/config")

// Browser: the calculator's quote, through the same math as a club's bill.
export const quotePublicPricing = async (body: PricingQuoteBody) =>
  await getApiClient().request<PricingQuote, PricingQuoteBody>({
    method: "post",
    url: "/public/pricing/quote",
    data: body,
  })
