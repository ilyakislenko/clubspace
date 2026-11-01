import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClassSubstitution = ApiTypes.ClassSubstitutionOutputDtoOutput
export type SubstituteCandidate =
  ApiTypes.ListSubstituteCandidatesOutputDtoOutput["data"][number]
// What the schedule ships per class.
export type ScheduleSubstitution = NonNullable<
  ApiTypes.GetWorkspaceScheduleOutputOutput["sessions"][number]["substitution"]
>

const base = (workspaceId: string) =>
  `/workspaces/${workspaceId}/class-substitutions`

export const listClassSubstitutions = async (p: {
  workspaceId: string
  from: string
  to: string
}) =>
  getApiClient().request<{ data: ClassSubstitution[] }>({
    method: "get",
    url: base(p.workspaceId),
    params: { from: p.from, to: p.to },
  })

export const listSubstituteCandidates = async (p: { workspaceId: string }) =>
  getApiClient().request<{ data: SubstituteCandidate[] }>({
    method: "get",
    url: `${base(p.workspaceId)}/candidates`,
  })

// No substituteId = the caller takes the class themselves.
export const createClassSubstitution = async (p: {
  workspaceId: string
  slotId: string
  sessionDate: string
  substituteId?: string
}) =>
  getApiClient().request<
    ClassSubstitution,
    { slotId: string; sessionDate: string; substituteId?: string }
  >({
    method: "post",
    url: base(p.workspaceId),
    data: {
      slotId: p.slotId,
      sessionDate: p.sessionDate,
      ...(p.substituteId ? { substituteId: p.substituteId } : {}),
    },
  })

export const approveClassSubstitution = async (p: {
  workspaceId: string
  substitutionId: string
}) =>
  getApiClient().request<{ substitution: ClassSubstitution | null }>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.substitutionId}/approve`,
  })

export const declineClassSubstitution = async (p: {
  workspaceId: string
  substitutionId: string
}) =>
  getApiClient().request<{ substitution: ClassSubstitution | null }>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.substitutionId}/decline`,
  })

export const cancelClassSubstitution = async (p: {
  workspaceId: string
  substitutionId: string
}) =>
  getApiClient().request<{ substitution: ClassSubstitution | null }>({
    method: "delete",
    url: `${base(p.workspaceId)}/${p.substitutionId}`,
  })
