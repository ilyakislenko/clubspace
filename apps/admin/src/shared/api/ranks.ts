import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type RankLadder = ApiTypes.RankLadderOutputDtoOutput
export type RankLevel = RankLadder["levels"][number]
export type LadderInput = ApiTypes.CreateLadderInput
export type LevelInput = ApiTypes.CreateLevelInput
export type MemberRanks = ApiTypes.MemberRanksOutputOutput
export type Promotion = MemberRanks["history"][number]
export type PromoteInput = ApiTypes.PromoteMemberInput

const ws = (id: string) => `/workspaces/${id}`

// ---- Ladders & levels ----

export const listRankLadders = async (p: {
  workspaceId: string
  includeInactive?: boolean
}): Promise<{ data: RankLadder[] }> =>
  await getApiClient().request<{ data: RankLadder[] }>({
    method: "get",
    url: `${ws(p.workspaceId)}/rank-ladders`,
    params: { includeInactive: p.includeInactive },
  })

export const createRankLadder = async (p: {
  workspaceId: string
  data: LadderInput
}): Promise<RankLadder> =>
  await getApiClient().request<RankLadder, LadderInput>({
    method: "post",
    url: `${ws(p.workspaceId)}/rank-ladders`,
    data: p.data,
  })

export const updateRankLadder = async (p: {
  workspaceId: string
  ladderId: string
  data: Partial<LadderInput> & { isActive?: boolean }
}): Promise<RankLadder> =>
  await getApiClient().request<RankLadder, typeof p.data>({
    method: "patch",
    url: `${ws(p.workspaceId)}/rank-ladders/${p.ladderId}`,
    data: p.data,
  })

export const deleteRankLadder = async (p: {
  workspaceId: string
  ladderId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${ws(p.workspaceId)}/rank-ladders/${p.ladderId}`,
  })

export const createRankLevel = async (p: {
  workspaceId: string
  ladderId: string
  data: LevelInput
}): Promise<RankLevel> =>
  await getApiClient().request<RankLevel, LevelInput>({
    method: "post",
    url: `${ws(p.workspaceId)}/rank-ladders/${p.ladderId}/levels`,
    data: p.data,
  })

export const updateRankLevel = async (p: {
  workspaceId: string
  ladderId: string
  levelId: string
  data: Partial<LevelInput> & { isActive?: boolean }
}): Promise<RankLevel> =>
  await getApiClient().request<RankLevel, typeof p.data>({
    method: "patch",
    url: `${ws(p.workspaceId)}/rank-ladders/${p.ladderId}/levels/${p.levelId}`,
    data: p.data,
  })

export const deleteRankLevel = async (p: {
  workspaceId: string
  ladderId: string
  levelId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${ws(p.workspaceId)}/rank-ladders/${p.ladderId}/levels/${p.levelId}`,
  })

// ---- Member promotions ----

export const promoteMember = async (p: {
  workspaceId: string
  userId: string
  data: PromoteInput
}): Promise<Promotion> =>
  await getApiClient().request<Promotion, PromoteInput>({
    method: "post",
    url: `${ws(p.workspaceId)}/members/${p.userId}/rank`,
    data: p.data,
  })

export const getMemberRanks = async (p: {
  workspaceId: string
  userId: string
}): Promise<MemberRanks> =>
  await getApiClient().request<MemberRanks>({
    method: "get",
    url: `${ws(p.workspaceId)}/members/${p.userId}/ranks`,
  })
