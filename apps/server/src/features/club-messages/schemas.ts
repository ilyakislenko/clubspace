import { z } from 'zod'

import { PUSH_SKIPS } from '../../domains/messages/kinds'
import { CLUB_MESSAGE_SEGMENTS } from '../../domains/messages/segment-where'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { displayName } from '../attendance/schemas'

export const CLUB_MESSAGES_DEFAULT_PER_PAGE = 50
export const CLUB_MESSAGES_MAX_PER_PAGE = 200
// «Отправить позже»: at most this far ahead.
export const CLUB_MESSAGE_MAX_SCHEDULE_DAYS = 30

export const ClubMessageSegmentSchema = z.enum(CLUB_MESSAGE_SEGMENTS)
export const ClubMessageStatusSchema = z.enum(['SCHEDULED', 'SENT', 'CANCELLED'])

export const PagingQueryFields = {
    curPage: z.coerce.number().int().min(1).optional(),
    perPage: z.coerce.number().int().min(1).max(CLUB_MESSAGES_MAX_PER_PAGE).optional(),
}

// Who a message goes to and how (docs/design/2026-11-26-broadcast-and-direct-messages.md
// §4.2). Flat: the segment names which of directionId / groupIds / memberIds
// it reads (refineTarget); the handler checks the sender may use it.
export const ComposeFields = {
    segment: ClubMessageSegmentSchema,
    // DIRECTION.
    directionId: z.string().uuid().optional(),
    // GROUPS.
    groupIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    // MEMBERS: one id = «Личное сообщение».
    memberIds: z.array(z.string().uuid()).min(1).max(200).optional(),
    // «Служебное — дойдёт и тем, кто отключил сообщения клуба» (sport leads).
    isService: z.boolean().optional(),
    // «Срочно — отправить сейчас, даже ночью» (2 per sender per day).
    urgent: z.boolean().optional(),
    // «Также отправить на e-mail» (the club's switch must be on).
    withEmail: z.boolean().optional(),
    // «Отправить позже» (≤ 30 days ahead); quiet hours may move it later.
    sendAt: z.iso.datetime().optional(),
}

export const refineTarget = (
    v: { segment: string; directionId?: string; groupIds?: string[]; memberIds?: string[] },
    ctx: z.RefinementCtx,
): void => {
    if (v.segment === 'GROUPS' && !v.groupIds?.length) {
        ctx.addIssue({ code: 'custom', path: ['groupIds'], message: 'Выберите группы' })
    }
    if (v.segment === 'DIRECTION' && !v.directionId) {
        ctx.addIssue({ code: 'custom', path: ['directionId'], message: 'Выберите направление' })
    }
    if (v.segment === 'MEMBERS' && !v.memberIds?.length) {
        ctx.addIssue({ code: 'custom', path: ['memberIds'], message: 'Выберите учеников' })
    }
}

export const ClubMessageOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    authorName: z.string(),
    segment: ClubMessageSegmentSchema,
    // «Группы: Дети 7–9, Взрослые утро», «Продлить», «Иван Петров».
    audienceLabel: z.string(),
    isDirect: z.boolean(),
    isService: z.boolean(),
    urgent: z.boolean(),
    withEmail: z.boolean(),
    status: ClubMessageStatusSchema,
    sendAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    recipientCount: z.number().int(),
    pushCount: z.number().int(),
    emailCount: z.number().int(),
    readCount: z.number().int(),
    createdAt: z.iso.datetime(),
    // With `GET messages?userId=`: when that member opened it (null = not
    // opened, or no filter).
    recipientReadAt: z.iso.datetime().nullable(),
})
export type ClubMessageOutput = z.infer<typeof ClubMessageOutputSchema>

export const ClubMessageRecipientOutputSchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    // A child: push and e-mail went to its guardians.
    isDependent: z.boolean(),
    guardianNames: z.array(z.string()),
    // null = push sent; why not otherwise.
    pushSkip: z.enum(PUSH_SKIPS).nullable(),
    emailedAt: z.iso.datetime().nullable(),
    readAt: z.iso.datetime().nullable(),
})

export const MyClubMessageOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    authorName: z.string(),
    sentAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
    club: z.object({ name: z.string(), logoUrl: z.string().nullable() }),
})
export type MyClubMessageOutput = z.infer<typeof MyClubMessageOutputSchema>

export const clubMessageSelect = {
    id: true,
    title: true,
    body: true,
    authorName: true,
    segment: true,
    directionId: true,
    groupIds: true,
    memberIds: true,
    isDirect: true,
    isService: true,
    urgent: true,
    withEmail: true,
    status: true,
    sendAt: true,
    sentAt: true,
    recipientCount: true,
    pushCount: true,
    emailCount: true,
    readCount: true,
    createdAt: true,
} as const satisfies Prisma.ClubMessageSelect
export type ClubMessageRow = Prisma.ClubMessageGetPayload<{ select: typeof clubMessageSelect }>

const SEGMENT_LABELS: Record<string, string> = {
    ALL: 'Все ученики',
    RENEW: 'Продлить',
    UNPAID: 'Не оплатили',
    INACTIVE: 'Не были 30 дней',
    CALL_LIST: 'Кому позвонить',
}

// The «Кому» line of each message, from the names as they are now (a deleted
// group or a gone member drops out of the line; the segment stays).
export const loadAudienceLabels = async (
    prisma: Pick<PrismaService, 'group' | 'direction' | 'user'>,
    workspaceId: string,
    rows: ClubMessageRow[],
): Promise<Map<string, string>> => {
    const groupIds = [...new Set(rows.flatMap((r) => (r.segment === 'GROUPS' ? r.groupIds : [])))]
    const directionIds = [
        ...new Set(rows.flatMap((r) => (r.segment === 'DIRECTION' && r.directionId ? [r.directionId] : []))),
    ]
    // Two names per message are enough for the line.
    const memberIds = [
        ...new Set(rows.flatMap((r) => (r.segment === 'MEMBERS' ? r.memberIds.slice(0, 2) : []))),
    ]
    const [groups, directions, users] = await Promise.all([
        groupIds.length
            ? prisma.group.findMany({
                  where: { id: { in: groupIds }, workspaceId },
                  select: { id: true, name: true },
              })
            : [],
        directionIds.length
            ? prisma.direction.findMany({
                  where: { id: { in: directionIds }, workspaceId },
                  select: { id: true, name: true },
              })
            : [],
        memberIds.length
            ? prisma.user.findMany({
                  where: { id: { in: memberIds } },
                  select: { id: true, firstname: true, lastname: true, email: true },
              })
            : [],
    ])
    const groupName = new Map(groups.map((g) => [g.id, g.name]))
    const directionName = new Map(directions.map((d) => [d.id, d.name]))
    const userName = new Map(users.map((u) => [u.id, displayName(u)]))
    const labels = new Map<string, string>()
    for (const r of rows) {
        let label: string
        if (r.segment === 'GROUPS') {
            const names = r.groupIds.flatMap((id) => groupName.get(id) ?? [])
            label = names.length ? `Группы: ${names.join(', ')}` : 'Группы'
        } else if (r.segment === 'DIRECTION') {
            const name = r.directionId ? directionName.get(r.directionId) : undefined
            label = name ? `Направление: ${name}` : 'Направление'
        } else if (r.segment === 'MEMBERS') {
            const names = r.memberIds.slice(0, 2).flatMap((id) => userName.get(id) ?? [])
            const rest = r.memberIds.length - names.length
            label =
                names.length === 0
                    ? 'Ученики'
                    : rest > 0
                      ? `${names.join(', ')} и ещё ${rest}`
                      : names.join(', ')
        } else {
            label = SEGMENT_LABELS[r.segment]
        }
        labels.set(r.id, label)
    }
    return labels
}

export const serializeClubMessage = (
    r: ClubMessageRow,
    audienceLabel: string,
    recipientReadAt: Date | null = null,
): ClubMessageOutput => ({
    id: r.id,
    title: r.title,
    body: r.body,
    authorName: r.authorName,
    segment: r.segment,
    audienceLabel,
    isDirect: r.isDirect,
    isService: r.isService,
    urgent: r.urgent,
    withEmail: r.withEmail,
    status: r.status,
    sendAt: r.sendAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    recipientCount: r.recipientCount,
    pushCount: r.pushCount,
    emailCount: r.emailCount,
    readCount: r.readCount,
    createdAt: r.createdAt.toISOString(),
    recipientReadAt: recipientReadAt?.toISOString() ?? null,
})

// One message with its «Кому» line.
export const loadClubMessageOutput = async (
    prisma: Pick<PrismaService, 'group' | 'direction' | 'user'>,
    workspaceId: string,
    row: ClubMessageRow,
): Promise<ClubMessageOutput> => {
    const labels = await loadAudienceLabels(prisma, workspaceId, [row])
    return serializeClubMessage(row, labels.get(row.id) ?? '')
}
