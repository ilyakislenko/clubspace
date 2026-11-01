import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// A guardian's children (dependents): profiles without a login of their own.
// Always the signed-in guardian's calls — /me/dependents is never on the
// X-Act-As allowlist (shared/api/act-as), so a child profile can't reach it.

export type MyDependent = ApiTypes.MyDependentOutputOutput
export type DependentRelation = MyDependent["relation"]
export type AddMyDependentInput = ApiTypes.AddMyDependentInput
export type ConfirmMyDependentInput = ApiTypes.ConfirmMyDependentInput
export type UpdateMyDependentInput = ApiTypes.UpdateMyDependentInput
export type RemoveMyDependentResult = ApiTypes.RemoveMyDependentOutputOutput

// Confirmed children plus the ones a club added and named this guardian for.
export const listMyDependents = async () =>
  await getApiClient().request<ApiTypes.ListMyDependentsOutputOutput>({
    method: "get",
    url: "/me/dependents",
  })

export const addMyDependent = async (data: AddMyDependentInput) =>
  await getApiClient().request<MyDependent, AddMyDependentInput>({
    method: "post",
    url: "/me/dependents",
    data,
  })

// Accepts a club's invitation (a PENDING guardianship), with consent.
export const confirmMyDependent = async (params: {
  dependentId: string
  data: ConfirmMyDependentInput
}) =>
  await getApiClient().request<MyDependent, ConfirmMyDependentInput>({
    method: "post",
    url: `/me/dependents/${params.dependentId}/confirm`,
    data: params.data,
  })

// Confirmed children only.
export const updateMyDependent = async (params: {
  dependentId: string
  data: UpdateMyDependentInput
}) =>
  await getApiClient().request<MyDependent, UpdateMyDependentInput>({
    method: "patch",
    url: `/me/dependents/${params.dependentId}`,
    data: params.data,
  })

// Declines a PENDING invitation, or steps back from a confirmed child while
// another confirmed guardian remains (the server refuses the last one).
export const unlinkMyDependent = async (dependentId: string) =>
  await getApiClient().request<RemoveMyDependentResult>({
    method: "delete",
    url: `/me/dependents/${dependentId}/guardianship`,
  })

// Deletes the child's profile everywhere, like an account deletion.
export const deleteMyDependent = async (dependentId: string) =>
  await getApiClient().request<RemoveMyDependentResult>({
    method: "delete",
    url: `/me/dependents/${dependentId}`,
  })
