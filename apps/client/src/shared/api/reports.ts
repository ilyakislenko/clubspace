import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type FileReportPayload = ApiTypes.FileContentReportInput

export const fileContentReport = async (payload: FileReportPayload) => {
  return await getApiClient().request<
    ApiTypes.FileContentReportOutputOutput,
    FileReportPayload
  >({
    method: "post",
    url: "/reports/content",
    data: payload,
  })
}
