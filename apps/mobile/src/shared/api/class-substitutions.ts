import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClassSubstitution = ApiTypes.ClassSubstitutionOutputDtoOutput
export type SubstituteCandidate =
  ApiTypes.ListSubstituteCandidatesOutputDtoOutput["data"][number]

const base = (workspaceId: string) =>
  `/workspaces/${workspaceId}/class-substitutions`

// Substitutions of the period the viewer is part of (all of them for a club
// admin; for a coach the ones they run, asked for, or of their groups).
export const listClassSubstitutions = async (params: {
  workspaceId: string
  from: string
  to: string
}): Promise<ClassSubstitution[]> =>
  (
    await getApiClient().request<{ data: ClassSubstitution[] }>({
      method: "get",
      url: base(params.workspaceId),
      params: { from: params.from, to: params.to },
    })
  ).data

// Coaches who can stand in (the «Назначить замену» picker).
export const listSubstituteCandidates = async (params: {
  workspaceId: string
}): Promise<SubstituteCandidate[]> =>
  (
    await getApiClient().request<{ data: SubstituteCandidate[] }>({
      method: "get",
      url: `${base(params.workspaceId)}/candidates`,
    })
  ).data

// No substituteId = «Взять занятие» (the caller offers to take the class).
export const createClassSubstitution = async (params: {
  workspaceId: string
  slotId: string
  sessionDate: string
  substituteId?: string
}): Promise<ClassSubstitution> =>
  await getApiClient().request<
    ClassSubstitution,
    { slotId: string; sessionDate: string; substituteId?: string }
  >({
    method: "post",
    url: base(params.workspaceId),
    data: {
      slotId: params.slotId,
      sessionDate: params.sessionDate,
      ...(params.substituteId ? { substituteId: params.substituteId } : {}),
    },
  })

export const approveClassSubstitution = async (params: {
  workspaceId: string
  substitutionId: string
}): Promise<void> => {
  await getApiClient().request({
    method: "post",
    url: `${base(params.workspaceId)}/${params.substitutionId}/approve`,
  })
}

export const declineClassSubstitution = async (params: {
  workspaceId: string
  substitutionId: string
}): Promise<void> => {
  await getApiClient().request({
    method: "post",
    url: `${base(params.workspaceId)}/${params.substitutionId}/decline`,
  })
}

// Withdraws a request or cancels an approved substitution.
export const cancelClassSubstitution = async (params: {
  workspaceId: string
  substitutionId: string
}): Promise<void> => {
  await getApiClient().request({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.substitutionId}`,
  })
}
