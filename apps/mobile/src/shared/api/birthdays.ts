import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type BirthdaysToday = ApiTypes.ListBirthdaysTodayOutputOutput
export type BirthdayMember = BirthdaysToday["members"][number]

// Staff: the club's members with a birthday today (club-local), a coach's
// own groups only.
export const listBirthdaysToday = async (params: {
  workspaceId: string
}): Promise<BirthdaysToday> =>
  await getApiClient().request<BirthdaysToday>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/birthdays/today`,
  })
