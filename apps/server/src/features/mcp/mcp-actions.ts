// Action tools — writes an ИИ-ассистент may make on the club's behalf — with
// mandatory confirmation (docs/mcp.md «Действия»). Not exposed yet: only a
// token carrying the 'actions' scope sees them, and no token can get that
// scope until ENABLED_AI_TOKEN_SCOPES lists it. The registry is empty until
// the first action ships; the confirmation protocol below is what every
// action goes through.
//
// Protocol: the first tools/call (no `confirmation`) changes nothing and
// returns a preview — what will happen, in Russian — plus a confirmation code
// bound to this token, this tool and exactly these arguments, valid
// ACTION_CONFIRMATION_TTL_MS. The assistant must show the preview to the
// person and call again with the code only after they agree. Any other
// arguments, another token or an expired code are refused.
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'

import type { McpTool, McpToolContext } from './mcp-tool'

export const ACTIONS_SCOPE = 'actions'

export const ACTION_CONFIRMATION_TTL_MS = 5 * 60 * 1000

export type McpActionPreview = {
    // One sentence: «Заморозить абонемент участника m_… с 3 по 16 ноября».
    summary: string
    // Every visible consequence (notifications sent, dates moved, money).
    effects: string[]
}

export type McpActionTool = McpTool & {
    kind: 'action'
    preview: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<McpActionPreview>
}

export const isActionTool = (tool: McpTool): tool is McpActionTool => tool.kind === 'action'

// Write tools, each with its preview. Empty until the first action ships.
export const MCP_ACTION_TOOLS: readonly McpActionTool[] = []

// The argument every action tool accepts on top of its own.
export const confirmationInput = {
    confirmation: z
        .string()
        .max(512)
        .optional()
        .describe(
            'Код подтверждения из предыдущего ответа этого инструмента. Передавайте только после явного согласия человека с описанием действия.',
        ),
}

// Key order must not change the hash: {a,b} and {b,a} are the same request.
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
    }
    return value
}

const argsDigest = (args: Record<string, unknown>): string => {
    const { confirmation: _ignored, ...rest } = args
    return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('base64url')
}

const sign = (secret: string, payload: string): string =>
    createHmac('sha256', secret).update(`ai-action:${payload}`).digest('base64url')

export const signActionConfirmation = (
    secret: string,
    p: { tokenId: string; tool: string; args: Record<string, unknown>; expiresAt: Date },
): string => {
    const payload = Buffer.from(
        JSON.stringify({ t: p.tokenId, n: p.tool, a: argsDigest(p.args), e: p.expiresAt.getTime() }),
    ).toString('base64url')
    return `${payload}.${sign(secret, payload)}`
}

export const verifyActionConfirmation = (
    secret: string,
    code: string,
    p: { tokenId: string; tool: string; args: Record<string, unknown>; now: Date },
): boolean => {
    const [payload, mac] = code.split('.')
    if (!payload || !mac) return false
    const expected = Buffer.from(sign(secret, payload))
    const given = Buffer.from(mac)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
    let claims: { t?: unknown; n?: unknown; a?: unknown; e?: unknown }
    try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
        return false
    }
    return (
        claims.t === p.tokenId &&
        claims.n === p.tool &&
        claims.a === argsDigest(p.args) &&
        typeof claims.e === 'number' &&
        claims.e > p.now.getTime()
    )
}
