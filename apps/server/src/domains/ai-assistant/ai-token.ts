// Personal access tokens for the ИИ-ассистент (MCP, docs/mcp.md). The secret is
// shown once; only its SHA-256 is stored, so a leaked database cannot be
// replayed against /mcp.
import { createHash, randomBytes } from 'crypto'

export const AI_TOKEN_PREFIX = 'csai_'

// Every scope a token can carry. 'read' — the read-only tools; 'actions' —
// writes with mandatory confirmation, prepared but not granted yet
// (ENABLED_AI_TOKEN_SCOPES, docs/mcp.md «Действия»).
export const AI_TOKEN_SCOPES = ['read', 'actions'] as const
export type AiTokenScope = (typeof AI_TOKEN_SCOPES)[number]

// What a club can grant today. Adding 'actions' here is the switch that opens
// the action tools (features/mcp/mcp-actions.ts) to tokens created afterwards.
export const ENABLED_AI_TOKEN_SCOPES: readonly AiTokenScope[] = ['read']

// Offered lifetimes in days; null = бессрочно.
export const AI_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const

const DAY_MS = 24 * 60 * 60 * 1000

export const hashAiToken = (secret: string): string =>
    createHash('sha256').update(secret).digest('hex')

export const generateAiToken = (): {
    secret: string
    hash: string
    prefix: string
} => {
    const secret = `${AI_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    return { secret, hash: hashAiToken(secret), prefix: secret.slice(0, 10) }
}

// Cheap shape check before a database lookup: anything else (a JWT, garbage)
// is refused without touching Postgres.
export const looksLikeAiToken = (value: string): boolean =>
    value.startsWith(AI_TOKEN_PREFIX) && value.length > 20 && value.length < 128

export const aiTokenExpiresAt = (
    now: Date,
    expiresInDays: number | null,
): Date | null =>
    expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY_MS)

export type AiTokenState = 'active' | 'expired' | 'revoked'

export const aiTokenState = (
    row: { revokedAt: Date | null; expiresAt: Date | null },
    now: Date,
): AiTokenState => {
    if (row.revokedAt) return 'revoked'
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired'
    return 'active'
}
