import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyConsent = ApiTypes.GetMyConsentOutputOutput

// The user's standing on the current edition of the personal-data consent
// (152-ФЗ). Stays reachable while consent is pending — almost every other
// authenticated endpoint answers 403 CONSENT_REQUIRED until it is accepted.
export const getMyConsent = async (): Promise<MyConsent> => {
  return await getApiClient().request<MyConsent>({
    method: "get",
    url: "/me/consent",
  })
}

// `version` must be the edition the user was shown; the server answers 409
// when a newer one was published in between, and the caller re-reads it.
export const acceptMyConsent = async (
  version: string,
): Promise<ApiTypes.AcceptMyConsentOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.AcceptMyConsentOutputOutput,
    ApiTypes.AcceptMyConsentInput
  >({
    method: "post",
    url: "/me/consent",
    data: { version },
  })
}
