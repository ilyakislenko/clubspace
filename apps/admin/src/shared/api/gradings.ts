import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type RankGradingDetail = ApiTypes.RankGradingDetailOutputDtoOutput
export type RankGradingCandidate = RankGradingDetail["candidates"][number]
export type RankGradingSummary =
  ApiTypes.ListRankGradingsOutputOutput["data"][number]
export type RankGradingResult = RankGradingCandidate["result"]
export type CreateGradingInput = ApiTypes.CreateRankGradingInput
export type UpdateGradingInput = ApiTypes.UpdateRankGradingInput
export type UpdateCandidateInput = ApiTypes.UpdateRankGradingCandidateInput
export type RecordResultsInput = ApiTypes.RecordRankGradingResultsInput
export type RecordResultsOutput = ApiTypes.RecordRankGradingResultsOutputOutput
export type RankReadiness = ApiTypes.GetRankReadinessOutputOutput
export type ReadinessEntry = RankReadiness["data"][number]

const base = (workspaceId: string) => `/workspaces/${workspaceId}/rank-gradings`

export const getRankReadiness = async (p: {
  workspaceId: string
  ladderId?: string
  groupId?: string
}): Promise<RankReadiness> =>
  await getApiClient().request<RankReadiness>({
    method: "get",
    url: `/workspaces/${p.workspaceId}/rank-readiness`,
    params: { ladderId: p.ladderId, groupId: p.groupId },
  })

export const listRankGradings = async (p: {
  workspaceId: string
  ladderId?: string
}): Promise<{ data: RankGradingSummary[] }> =>
  await getApiClient().request<{ data: RankGradingSummary[] }>({
    method: "get",
    url: base(p.workspaceId),
    params: { ladderId: p.ladderId },
  })

export const createRankGrading = async (p: {
  workspaceId: string
  data: CreateGradingInput
}): Promise<RankGradingDetail> =>
  await getApiClient().request<RankGradingDetail, CreateGradingInput>({
    method: "post",
    url: base(p.workspaceId),
    data: p.data,
  })

export const getRankGrading = async (p: {
  workspaceId: string
  gradingId: string
}): Promise<RankGradingDetail> =>
  await getApiClient().request<RankGradingDetail>({
    method: "get",
    url: `${base(p.workspaceId)}/${p.gradingId}`,
  })

export const updateRankGrading = async (p: {
  workspaceId: string
  gradingId: string
  data: UpdateGradingInput
}): Promise<RankGradingDetail> =>
  await getApiClient().request<RankGradingDetail, UpdateGradingInput>({
    method: "patch",
    url: `${base(p.workspaceId)}/${p.gradingId}`,
    data: p.data,
  })

export const deleteRankGrading = async (p: {
  workspaceId: string
  gradingId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${base(p.workspaceId)}/${p.gradingId}`,
  })

export const addRankGradingCandidates = async (p: {
  workspaceId: string
  gradingId: string
  data: ApiTypes.AddRankGradingCandidatesInput
}): Promise<RankGradingDetail> =>
  await getApiClient().request<
    RankGradingDetail,
    ApiTypes.AddRankGradingCandidatesInput
  >({
    method: "post",
    url: `${base(p.workspaceId)}/${p.gradingId}/candidates`,
    data: p.data,
  })

export const updateRankGradingCandidate = async (p: {
  workspaceId: string
  gradingId: string
  candidateId: string
  data: UpdateCandidateInput
}): Promise<RankGradingDetail> =>
  await getApiClient().request<RankGradingDetail, UpdateCandidateInput>({
    method: "patch",
    url: `${base(p.workspaceId)}/${p.gradingId}/candidates/${p.candidateId}`,
    data: p.data,
  })

export const removeRankGradingCandidate = async (p: {
  workspaceId: string
  gradingId: string
  candidateId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${base(p.workspaceId)}/${p.gradingId}/candidates/${p.candidateId}`,
  })

export const recordRankGradingResults = async (p: {
  workspaceId: string
  gradingId: string
  data: RecordResultsInput
}): Promise<RecordResultsOutput> =>
  await getApiClient().request<RecordResultsOutput, RecordResultsInput>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.gradingId}/results`,
    data: p.data,
  })
