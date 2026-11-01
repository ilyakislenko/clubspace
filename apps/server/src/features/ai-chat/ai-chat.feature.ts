import { z } from 'zod'

import { MAX_QUESTION_CHARS } from './ai-chat-utils'

// «ИИ-ассистент» chat in the admin (sidebar → Аналитика): a staff member asks
// about the club in plain words; the model answers through the same read-only
// tools as the MCP server (features/mcp), in the asker's scope — admins the
// whole club, a руководитель направления their directions. The model sees
// people only as pseudonyms; names come back to the screen as chips.

export const AiChatEntitySchema = z.object({
    // The exact text in an answer: «m_0123456789», «c_…», «[group:<id>]», «[plan:<id>]».
    token: z.string(),
    type: z.enum(['member', 'staff', 'group', 'plan']),
    id: z.string().uuid(),
    label: z.string(),
})
export type AiChatEntity = z.infer<typeof AiChatEntitySchema>

export const AiChatLimitSchema = z.object({
    perMonth: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int(),
})

export const AiChatStateOutputSchema = z.object({
    // AI_CHAT_API_KEY is set on the server.
    configured: z.boolean(),
    model: z.string().nullable(),
    // 'club' — the whole club; 'directions' — a direction manager's directions.
    scope: z.enum(['club', 'directions']),
    consent: z.object({
        accepted: z.boolean(),
        acceptedAt: z.iso.datetime().nullable(),
        // Only the club owner turns the chat on.
        canAccept: z.boolean(),
        warning: z.object({ version: z.string(), title: z.string(), text: z.string() }),
    }),
    limit: AiChatLimitSchema,
    suggestions: z.array(z.string()),
})

export const AcceptAiChatWarningInputSchema = z.object({
    // The edition of the warning the owner saw (consent.warning.version).
    warningVersion: z.string().max(64),
})

export const AiChatConversationSummarySchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    questions: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export const ListAiChatConversationsOutputSchema = z.object({
    data: z.array(AiChatConversationSummarySchema),
})

export const AiChatTurnSchema = z.object({
    question: z.string(),
    askedAt: z.iso.datetime(),
    steps: z.array(z.object({ tool: z.string(), label: z.string(), isError: z.boolean() })),
    // Markdown with entity tokens (see AiChatEntitySchema.token).
    answer: z.string(),
    error: z.string().nullable(),
})

export const AiChatConversationOutputSchema = AiChatConversationSummarySchema.extend({
    turns: z.array(AiChatTurnSchema),
    entities: z.array(AiChatEntitySchema),
})

export const DeleteAiChatConversationOutputSchema = z.object({ id: z.string().uuid() })

export const AskAiChatInputSchema = z.object({
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
})

export type AiChatStateResponse = z.infer<typeof AiChatStateOutputSchema>

export class GetAiChatStateFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}
export type GetAiChatStateFeatureResponse = AiChatStateResponse

export class AcceptAiChatWarningFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptAiChatWarningInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly ip: string | null,
        readonly userAgent: string | null,
    ) {}
}
export type AcceptAiChatWarningFeatureResponse = AiChatStateResponse

export class ListAiChatConversationsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}
export type ListAiChatConversationsFeatureResponse = z.infer<
    typeof ListAiChatConversationsOutputSchema
>

export class GetAiChatConversationFeature {
    constructor(
        readonly workspaceId: string,
        readonly conversationId: string,
        readonly invokerUserId: string,
    ) {}
}
export type GetAiChatConversationFeatureResponse = z.infer<typeof AiChatConversationOutputSchema>

export class DeleteAiChatConversationFeature {
    constructor(
        readonly workspaceId: string,
        readonly conversationId: string,
        readonly invokerUserId: string,
    ) {}
}
export type DeleteAiChatConversationFeatureResponse = z.infer<
    typeof DeleteAiChatConversationOutputSchema
>

// The stream's events, in order: start, then text / tool / entities as they
// happen, then done or error.
export type AiChatStreamEvent =
    | { event: 'start'; data: { conversationId: string; title: string } }
    | { event: 'text'; data: { text: string } }
    | {
          event: 'tool'
          data: { id: string; tool: string; label: string; status: 'running' | 'done' | 'error' }
      }
    | { event: 'entities'; data: { entities: AiChatEntity[] } }
    | {
          event: 'done'
          data: {
              usage: { inputTokens: number; outputTokens: number }
              limit: z.infer<typeof AiChatLimitSchema>
          }
      }
    | { event: 'error'; data: { message: string } }

export type AiChatEmit = (e: AiChatStreamEvent) => void

export class AskAiChatFeature {
    constructor(
        readonly payload: z.infer<typeof AskAiChatInputSchema>,
        readonly workspaceId: string,
        readonly conversationId: string,
        readonly invokerUserId: string,
    ) {}
}
// Everything is checked (access, consent, limit, the conversation) before the
// controller opens the stream; `run` then streams the turn.
export type AskAiChatFeatureResponse = {
    run: (emit: AiChatEmit, signal: AbortSignal) => Promise<void>
}
