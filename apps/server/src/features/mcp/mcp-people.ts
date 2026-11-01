// How a person appears in an ИИ-ассистент answer. The one place that decides
// what of a person leaves the server: in the default «обезличено» mode only a
// stable pseudonym (`ref`), never a name, phone or e-mail; with a PERSONAL
// token (the owner accepted the transfer warning) members also get their name
// and contacts, coaches their name.
import { pseudonymFor } from '../../domains/ai-assistant/pseudonym'

export type AiDataMode = 'PSEUDONYMIZED' | 'PERSONAL'

export type PersonRow = {
    id: string
    firstname: string | null
    lastname: string | null
    email?: string | null
    phone?: string | null
}

export type MemberView = {
    ref: string
    name?: string | null
    phone?: string | null
    email?: string | null
}

export type StaffView = { ref: string; name?: string | null }

const fullName = (u: PersonRow): string | null =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || null

// Who a pseudonym stands for, as the chat keeps it server-side (never sent to
// the model): kind + user id.
export type PersonRef = { kind: 'member' | 'staff'; userId: string }

export class McpPeople {
    constructor(
        private readonly secret: string,
        private readonly workspaceId: string,
        readonly mode: AiDataMode,
        // The admin chat records every person a tool put in an answer, so the
        // screen can turn their pseudonyms back into names and links.
        private readonly onPerson?: (ref: string, person: PersonRef) => void,
    ) {}

    get personal(): boolean {
        return this.mode === 'PERSONAL'
    }

    memberRef(userId: string): string {
        return pseudonymFor(this.secret, this.workspaceId, userId, 'member')
    }

    member(u: PersonRow): MemberView {
        const ref = this.memberRef(u.id)
        this.onPerson?.(ref, { kind: 'member', userId: u.id })
        if (!this.personal) return { ref }
        return {
            ref,
            name: fullName(u),
            phone: u.phone ?? null,
            email: u.email ?? null,
        }
    }

    staff(u: PersonRow): StaffView {
        const ref = pseudonymFor(this.secret, this.workspaceId, u.id, 'staff')
        this.onPerson?.(ref, { kind: 'staff', userId: u.id })
        return this.personal ? { ref, name: fullName(u) } : { ref }
    }
}
