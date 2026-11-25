import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead } from "./read-cache"

export type BirthdaysToday = ApiTypes.ListBirthdaysTodayOutputOutput
export type BirthdayMember = BirthdaysToday["members"][number]

// «Дни рождения сегодня» on «Сегодня»: the club's members with a birthday
// today (club-local), a coach's own groups only. Reloaded on the `members`
// signal, so shared in flight only, never kept.
export const listBirthdaysToday = (params: { workspaceId: string }) =>
  cachedRead(`birthdays:${params.workspaceId}`, () =>
    getApiClient().request<BirthdaysToday>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/birthdays/today`,
    }),
  )
