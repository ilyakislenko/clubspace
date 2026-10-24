import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type PersonalTraining = ApiTypes.PersonalTrainingOutputOutput
export type PersonalTrainingList = ApiTypes.ListPersonalTrainingsOutputOutput
export type PersonalTrainingForm = ApiTypes.PersonalTrainingFormOutputOutput
export type RequestPersonalTrainingInput = ApiTypes.RequestPersonalTrainingInput
export type ProposePersonalTrainingTimeInput =
  ApiTypes.ProposePersonalTrainingTimeInput
export type ClosePersonalTrainingInput = ApiTypes.ClosePersonalTrainingInput

const base = (workspaceId: string) =>
  `/workspaces/${workspaceId}/personal-trainings`

// Coaches who take personal sessions, and the gyms (with their zones) the
// member can pick for the request.
export const getPersonalTrainingForm = async (params: {
  workspaceId: string
}): Promise<PersonalTrainingForm> =>
  await getApiClient().request<PersonalTrainingForm>({
    method: "get",
    url: `${base(params.workspaceId)}/form`,
  })

// A coach opts in or out of taking personal sessions.
export const setPersonalTrainingOffer = async (params: {
  workspaceId: string
  enabled: boolean
}): Promise<{ offersPersonalTraining: boolean }> =>
  await getApiClient().request<
    { offersPersonalTraining: boolean },
    { enabled: boolean }
  >({
    method: "put",
    url: `${base(params.workspaceId)}/offer`,
    data: { enabled: params.enabled },
  })

// The caller's own requests (as member or as coach) from the last 90 days.
export const listPersonalTrainings = async (params: {
  workspaceId: string
}): Promise<PersonalTrainingList> =>
  await getApiClient().request<PersonalTrainingList>({
    method: "get",
    url: base(params.workspaceId),
  })

export const getPersonalTraining = async (params: {
  workspaceId: string
  requestId: string
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining>({
    method: "get",
    url: `${base(params.workspaceId)}/${params.requestId}`,
  })

export const requestPersonalTraining = async (params: {
  workspaceId: string
  data: RequestPersonalTrainingInput
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, RequestPersonalTrainingInput>({
    method: "post",
    url: base(params.workspaceId),
    data: params.data,
  })

// Coach picks one of the member's options, or the member takes the coach's
// latest proposal.
export const acceptPersonalTraining = async (params: {
  workspaceId: string
  requestId: string
  optionId: string
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, { optionId: string }>({
    method: "post",
    url: `${base(params.workspaceId)}/${params.requestId}/accept`,
    data: { optionId: params.optionId },
  })

export const proposePersonalTrainingTime = async (params: {
  workspaceId: string
  requestId: string
  data: ProposePersonalTrainingTimeInput
}): Promise<PersonalTraining> =>
  await getApiClient().request<
    PersonalTraining,
    ProposePersonalTrainingTimeInput
  >({
    method: "post",
    url: `${base(params.workspaceId)}/${params.requestId}/propose`,
    data: params.data,
  })

export const declinePersonalTraining = async (params: {
  workspaceId: string
  requestId: string
  comment?: string
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, ClosePersonalTrainingInput>({
    method: "post",
    url: `${base(params.workspaceId)}/${params.requestId}/decline`,
    data: { comment: params.comment },
  })

export const cancelPersonalTraining = async (params: {
  workspaceId: string
  requestId: string
  comment?: string
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, ClosePersonalTrainingInput>({
    method: "post",
    url: `${base(params.workspaceId)}/${params.requestId}/cancel`,
    data: { comment: params.comment },
  })
