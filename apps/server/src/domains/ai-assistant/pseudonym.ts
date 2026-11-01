// Stable pseudonyms for people an ИИ-ассистент reads about. In the default
// «обезличено» mode a member is `m_<10 hex>` and a coach `c_<10 hex>`: the same
// person always gets the same pseudonym in one club (the assistant can follow
// them across questions and pass it back to member_profile), different clubs
// get unrelated ones, and without the server secret nobody can map a pseudonym
// back to the person.
import { createHmac } from 'crypto'

export type PseudonymKind = 'member' | 'staff'

const PREFIX: Record<PseudonymKind, string> = { member: 'm_', staff: 'c_' }

export const PSEUDONYM_RE = /^[mc]_[0-9a-f]{10}$/

export const pseudonymFor = (
    secret: string,
    workspaceId: string,
    userId: string,
    kind: PseudonymKind,
): string =>
    PREFIX[kind] +
    createHmac('sha256', secret)
        .update(`ai-pseudonym:${workspaceId}:${userId}`)
        .digest('hex')
        .slice(0, 10)
