import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyConsent = ApiTypes.GetMyConsentOutputOutput
export type AcceptMyConsentInput = ApiTypes.AcceptMyConsentInput

// The caller's personal-data consent status. One of the few routes the API
// still answers while the consent is missing, so the gate can always ask.
export const getMyConsent = async (): Promise<MyConsent> => {
  return await getApiClient().request<MyConsent>({
    method: "get",
    url: "/me/consent",
  })
}

// Accepts the edition the user was shown. 409 when the edition changed in the
// meantime — refetch and show the new one.
export const acceptMyConsent = async (
  data: AcceptMyConsentInput,
): Promise<ApiTypes.AcceptMyConsentOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.AcceptMyConsentOutputOutput,
    AcceptMyConsentInput
  >({
    method: "post",
    url: "/me/consent",
    data,
  })
}
