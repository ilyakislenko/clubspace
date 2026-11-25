// «Сообщения» of a demo club (docs/design/2026-11-26-broadcast-and-direct-messages.md
// §8): the rows a sent message leaves behind — the message with its counters,
// one recipient row per student with the read state, and inbox Notification
// rows (sent, no push) only for the fixed demo accounts. Deterministic: who
// opened a message is drawn from the ids, not the generator's noise.
import { createHash } from 'crypto'

import { clubMessageKind } from '../messages/kinds'
import { guardianTopic } from '../notifications/guardian-routing'
import type { Prisma } from '../../infrastructure/prisma'

export type DemoMessageRecipient = {
    userId: string
    // The member muted the club (generated members do): no broadcast push.
    muted: boolean
    // Who the push and inbox row go to: the student, or a child's confirmed
    // guardians. Only demo accounts get inbox rows (generated people have no
    // devices); none = no device.
    inbox: { userId: string; dependent?: { id: string; name: string } }[]
    email: string | null
}

export type DemoMessageSpec = {
    id: string
    authorId: string
    authorName: string
    title: string
    body: string
    segment: Prisma.ClubMessageCreateManyInput['segment']
    directionId?: string
    groupIds?: string[]
    memberIds?: string[]
    isService?: boolean
    withEmail?: boolean
    createdAt: Date
    // null = still SCHEDULED for sendAt.
    sentAt: Date | null
    sendAt: Date
    // Share of recipients who opened it (0–1); the fixed accounts' state is
    // set explicitly by `readBy`.
    readShare: number
    readBy?: Record<string, boolean>
    recipients: DemoMessageRecipient[]
}

export type DemoMessageRows = {
    clubMessages: Prisma.ClubMessageCreateManyInput[]
    clubMessageRecipients: Prisma.ClubMessageRecipientCreateManyInput[]
    notifications: Prisma.NotificationCreateManyInput[]
}

const draw = (key: string): number =>
    parseInt(createHash('sha256').update(`clubspace-demo:msg:${key}`).digest('hex').slice(0, 8), 16) /
    0xffffffff

export const buildDemoMessages = (workspaceId: string, specs: DemoMessageSpec[]): DemoMessageRows => {
    const out: DemoMessageRows = { clubMessages: [], clubMessageRecipients: [], notifications: [] }
    for (const m of specs) {
        const isDirect = m.segment === 'MEMBERS' && (m.memberIds?.length ?? 0) === 1
        const kind = clubMessageKind({ isDirect, isService: m.isService ?? false })
        const exempt = kind !== 'message.broadcast'
        let pushCount = 0
        let emailCount = 0
        let readCount = 0
        const sentAt = m.sentAt
        if (sentAt) {
            for (const r of m.recipients) {
                const pushSkip = !exempt && r.muted ? 'muted' : r.inbox.length === 0 ? 'no_device' : null
                const read = m.readBy?.[r.userId] ?? draw(`${m.id}:${r.userId}`) < m.readShare
                const readAt = read
                    ? new Date(sentAt.getTime() + (1 + Math.floor(draw(`${m.id}:${r.userId}:at`) * 20)) * 3_600_000)
                    : null
                // As delivery: a member who muted the club gets no broadcast copy.
                const emailedAt = m.withEmail && r.email && pushSkip !== 'muted' ? sentAt : null
                if (pushSkip === null) pushCount += 1
                if (emailedAt) emailCount += 1
                if (readAt) readCount += 1
                out.clubMessageRecipients.push({
                    messageId: m.id,
                    workspaceId,
                    userId: r.userId,
                    pushSkip,
                    emailedAt,
                    readAt,
                    createdAt: sentAt,
                })
                if (pushSkip !== null) continue
                for (const to of r.inbox) {
                    out.notifications.push({
                        userId: to.userId,
                        type: 'PUSH',
                        topic: to.dependent
                            ? guardianTopic({ guardianIds: [], dependentName: to.dependent.name }, m.title)
                            : m.title,
                        message: m.body.length > 200 ? `${m.body.slice(0, 200)}…` : m.body,
                        metadata: {
                            kind,
                            workspaceId,
                            messageId: m.id,
                            ...(to.dependent ? { dependentId: to.dependent.id } : {}),
                        },
                        sent: true,
                        sentAt,
                        seen: readAt !== null,
                        createdAt: sentAt,
                    })
                }
            }
        }
        out.clubMessages.push({
            id: m.id,
            workspaceId,
            authorId: m.authorId,
            authorName: m.authorName,
            title: m.title,
            body: m.body,
            segment: m.segment,
            directionId: m.directionId ?? null,
            groupIds: m.groupIds ?? [],
            memberIds: m.memberIds ?? [],
            isDirect,
            isService: m.isService ?? false,
            urgent: false,
            withEmail: m.withEmail ?? false,
            status: sentAt ? 'SENT' : 'SCHEDULED',
            sendAt: m.sendAt,
            sentAt,
            recipientCount: sentAt ? m.recipients.length : 0,
            pushCount,
            emailCount,
            readCount,
            createdAt: m.createdAt,
        })
    }
    return out
}
