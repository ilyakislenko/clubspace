import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type DemoRequestPayload = ApiTypes.CreateDemoRequestInputDto

export const createDemoRequest = async (payload: DemoRequestPayload) =>
  await getApiClient().request<
    ApiTypes.CreateDemoRequestOutputOutput,
    DemoRequestPayload
  >({
    method: "post",
    url: "/public/demo-requests",
    data: payload,
  })
