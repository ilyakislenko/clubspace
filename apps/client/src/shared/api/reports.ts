import { getApiClient } from "./client"

export type FileReportPayload = {
  videoId?: string
  reporterContact: string
  reason: string
}

export const fileContentReport = async (payload: FileReportPayload) => {
  return await getApiClient().request<
    { status: "received"; referenceId: string },
    FileReportPayload
  >({
    method: "post",
    url: "/reports/content",
    data: payload,
  })
}
