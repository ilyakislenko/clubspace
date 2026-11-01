import { z } from 'zod'

import { AI_TOKEN_SCOPES } from '../../domains/ai-assistant/ai-token'

// «Интеграции → ИИ-ассистент»: personal access tokens an AI client (Claude,
// ChatGPT, Cursor) uses to read the club over MCP (docs/mcp.md). Created by
// the club's admins and руководители направлений; a token reads as its
// creator, with the creator's current role and directions.

export const AI_TOKEN_DATA_MODES = ['PSEUDONYMIZED', 'PERSONAL'] as const

export const AiTokenOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    // The first characters of the secret («csai_AbC1»), to tell tokens apart.
    tokenPrefix: z.string(),
    scopes: z.array(z.enum(AI_TOKEN_SCOPES)),
    // PSEUDONYMIZED = «обезличено», PERSONAL = «с персональными данными».
    dataMode: z.enum(AI_TOKEN_DATA_MODES),
    state: z.enum(['active', 'expired', 'revoked']),
    expiresAt: z.iso.datetime().nullable(),
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    createdBy: z.object({ id: z.string().uuid(), name: z.string() }),
    // Admins revoke any token of the club, a direction manager their own.
    canRevoke: z.boolean(),
})
export type AiTokenOutput = z.infer<typeof AiTokenOutputSchema>

export const ListAiTokensOutputSchema = z.object({
    data: z.array(AiTokenOutputSchema),
    // The address to paste into the AI client.
    mcpUrl: z.string(),
    // Only the club owner may create a PERSONAL token.
    canUsePersonalData: z.boolean(),
    // The warning the owner accepts first; send its version back on create.
    personalDataWarning: z.object({
        version: z.string(),
        title: z.string(),
        text: z.string(),
    }),
    // Lifetimes a token may be created with, in days (plus «бессрочно»).
    expiryDaysOptions: z.array(z.number().int()),
    rateLimitPerMinute: z.number().int(),
})

export const CreateAiTokenInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    dataMode: z.enum(AI_TOKEN_DATA_MODES),
    // One of expiryDaysOptions; null = бессрочно.
    expiresInDays: z.number().int().positive().nullable(),
    scopes: z.array(z.enum(AI_TOKEN_SCOPES)).min(1),
    // Required for PERSONAL: the edition of the warning the owner accepted.
    personalDataWarningVersion: z.string().max(64).optional(),
})

export const CreateAiTokenOutputSchema = z.object({
    token: AiTokenOutputSchema,
    // Shown once; only its hash is stored.
    secret: z.string(),
})

export class ListAiTokensFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}
export type ListAiTokensFeatureResponse = z.infer<typeof ListAiTokensOutputSchema>

export class CreateAiTokenFeature {
    constructor(
        readonly payload: z.infer<typeof CreateAiTokenInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly ip: string | null,
        readonly userAgent: string | null,
    ) {}
}
export type CreateAiTokenFeatureResponse = z.infer<typeof CreateAiTokenOutputSchema>

export class RevokeAiTokenFeature {
    constructor(
        readonly workspaceId: string,
        readonly tokenId: string,
        readonly invokerUserId: string,
    ) {}
}
export type RevokeAiTokenFeatureResponse = AiTokenOutput
