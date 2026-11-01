import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ChurnRiskList = ApiTypes.ListChurnRiskOutputOutput
export type ChurnRiskMember = ChurnRiskList["data"][number]
export type ChurnRiskLevel = ChurnRiskMember["level"]
export type CohortRetention = ApiTypes.GetCohortRetentionOutputOutput
export type CohortRow = CohortRetention["cohorts"][number]
export type CohortCell = CohortRow["cells"][number]
export type ScheduleOccupancy = ApiTypes.GetScheduleOccupancyOutputOutput
export type OccupancySlot = ScheduleOccupancy["slots"][number]
export type OccupancyHeatmapCell =
  ScheduleOccupancy["heatmap"][number]["cells"][number]
export type CoachAnalytics = ApiTypes.GetCoachAnalyticsOutputOutput
export type CoachStats = CoachAnalytics["coaches"][number]
export type RevenueForecast = ApiTypes.GetRevenueForecastOutputOutput
export type AnalyticsRefresh = ApiTypes.RefreshAnalyticsOutputOutput

// Every analytics read takes the same optional scope; the server narrows it
// further to a coach's own groups.
export type AnalyticsScope = {
  gymId?: string
  directionId?: string
  groupId?: string
  coachId?: string
}

const scopeParams = (s: AnalyticsScope) => ({
  gymId: s.gymId,
  directionId: s.directionId,
  groupId: s.groupId,
  coachId: s.coachId,
})

export const listChurnRisk = async (
  params: { workspaceId: string; minScore?: number } & AnalyticsScope,
): Promise<ChurnRiskList> =>
  await getApiClient().request<ChurnRiskList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/analytics/churn`,
    params: { ...scopeParams(params), minScore: params.minScore },
  })

export const getCohortRetention = async (
  params: { workspaceId: string } & AnalyticsScope,
): Promise<CohortRetention> =>
  await getApiClient().request<CohortRetention>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/analytics/cohorts`,
    params: scopeParams(params),
  })

export const getScheduleOccupancy = async (
  params: { workspaceId: string; weeks?: number } & AnalyticsScope,
): Promise<ScheduleOccupancy> =>
  await getApiClient().request<ScheduleOccupancy>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/analytics/occupancy`,
    params: { ...scopeParams(params), weeks: params.weeks },
  })

export const getCoachAnalytics = async (
  params: { workspaceId: string } & AnalyticsScope,
): Promise<CoachAnalytics> =>
  await getApiClient().request<CoachAnalytics>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/analytics/coaches`,
    params: scopeParams(params),
  })

export const getRevenueForecast = async (
  params: { workspaceId: string } & AnalyticsScope,
): Promise<RevenueForecast> =>
  await getApiClient().request<RevenueForecast>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/analytics/forecast`,
    params: scopeParams(params),
  })

export const refreshAnalytics = async (params: {
  workspaceId: string
}): Promise<AnalyticsRefresh> =>
  await getApiClient().request<AnalyticsRefresh, undefined>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/analytics/refresh`,
  })
