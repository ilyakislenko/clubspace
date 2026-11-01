import { aiTokenState } from '../../domains/ai-assistant/ai-token'
import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import { displayName } from '../attendance/schemas'
import type { AiTokenOutput } from './ai-tokens.feature'

export const aiTokenInclude = {
    createdBy: {
        select: { id: true, firstname: true, lastname: true, email: true },
    },
} as const

export type AiTokenRow = {
    id: string
    name: string
    tokenPrefix: string
    scopes: string[]
    dataMode: 'PSEUDONYMIZED' | 'PERSONAL'
    expiresAt: Date | null
    lastUsedAt: Date | null
    revokedAt: Date | null
    createdAt: Date
    createdById: string
    createdBy: {
        id: string
        firstname: string | null
        lastname: string | null
        email: string | null
    }
}

// Admin scope revokes any token of the club; anyone else only their own.
export const canRevokeAiToken = (
    access: Pick<AiAccess, 'directionIds' | 'userId'>,
    row: Pick<AiTokenRow, 'createdById'>,
): boolean => access.directionIds === null || row.createdById === access.userId

export const serializeAiToken = (
    row: AiTokenRow,
    access: Pick<AiAccess, 'directionIds' | 'userId'>,
    now: Date,
): AiTokenOutput => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes.filter(
        (s): s is AiTokenOutput['scopes'][number] =>
            s === 'read' || s === 'actions',
    ),
    dataMode: row.dataMode,
    state: aiTokenState(row, now),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdBy.id, name: displayName(row.createdBy) },
    canRevoke: canRevokeAiToken(access, row),
})
