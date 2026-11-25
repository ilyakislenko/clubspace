import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Мои выплаты»: the invoker's closed months (last 12, with the money, the
// rate and the adjustments' comments) and this month's counts without money.
// 403 when the club doesn't show payouts in the app.
export type MyPayroll = ApiTypes.MyPayrollOutputOutput
export type MyPayrollMonth = MyPayroll["months"][number]

export const getMyPayroll = async (params: {
  workspaceId: string
}): Promise<MyPayroll> =>
  await getApiClient().request<MyPayroll>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/payroll/me`,
  })
