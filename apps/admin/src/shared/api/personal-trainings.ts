import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// A member's request for a one-on-one session, decided by the chosen coach or
// a club-wide lead acting for them (the server's rule). The decisions only;
// the open requests are listed by `listOpenRequests`.
export type PersonalTraining = ApiTypes.PersonalTrainingOutputOutput
export type AcceptPersonalTrainingInput = ApiTypes.AcceptPersonalTrainingInput
export type ProposePersonalTrainingTimeInput = ApiTypes.ProposePersonalTrainingTimeInput
export type ClosePersonalTrainingInput = ApiTypes.ClosePersonalTrainingInput

const url = (workspaceId: string, requestId: string, action: string) =>
  `/workspaces/${workspaceId}/personal-trainings/${requestId}/${action}`

// Confirms one of the member's times: the session goes on the schedule.
export const acceptPersonalTraining = async (params: {
  workspaceId: string
  requestId: string
  data: AcceptPersonalTrainingInput
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, AcceptPersonalTrainingInput>({
    method: "post",
    url: url(params.workspaceId, params.requestId, "accept"),
    data: params.data,
  })

// Offers another time (wall clock in the request's time zone); the member
// answers in the app.
export const proposePersonalTrainingTime = async (params: {
  workspaceId: string
  requestId: string
  data: ProposePersonalTrainingTimeInput
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, ProposePersonalTrainingTimeInput>({
    method: "post",
    url: url(params.workspaceId, params.requestId, "propose"),
    data: params.data,
  })

export const declinePersonalTraining = async (params: {
  workspaceId: string
  requestId: string
  data: ClosePersonalTrainingInput
}): Promise<PersonalTraining> =>
  await getApiClient().request<PersonalTraining, ClosePersonalTrainingInput>({
    method: "post",
    url: url(params.workspaceId, params.requestId, "decline"),
    data: params.data,
  })
