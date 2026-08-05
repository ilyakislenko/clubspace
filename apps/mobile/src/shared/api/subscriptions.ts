import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MySubscription = ApiTypes.MySubscriptionOutputOutput
export type Subscription = MySubscription["history"][number]

// The current member's own abonement (current + history) and effective
// access window. Read-only — buying/renewing happens through the club.
export const getMySubscription = async (params: {
  workspaceId: string
}): Promise<MySubscription> =>
  await getApiClient().request<MySubscription>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/subscription`,
  })
