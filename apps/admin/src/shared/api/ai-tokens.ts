import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Интеграции → ИИ-ассистент»: club tokens for AI clients over MCP (docs/mcp.md).
export type AiTokensList = ApiTypes.ListAiTokensOutputOutput
export type AiToken = ApiTypes.AiTokenOutputDtoOutput
export type CreateAiTokenInput = ApiTypes.CreateAiTokenInput
export type CreatedAiToken = ApiTypes.CreateAiTokenOutputOutput

export const listAiTokens = async (params: {
  workspaceId: string
}): Promise<AiTokensList> =>
  getApiClient().request<AiTokensList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/ai-tokens`,
  })

export const createAiToken = async (params: {
  workspaceId: string
  data: CreateAiTokenInput
}): Promise<CreatedAiToken> =>
  getApiClient().request<CreatedAiToken, CreateAiTokenInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/ai-tokens`,
    data: params.data,
  })

export const revokeAiToken = async (params: {
  workspaceId: string
  tokenId: string
}): Promise<AiToken> =>
  getApiClient().request<AiToken, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/ai-tokens/${params.tokenId}`,
  })
