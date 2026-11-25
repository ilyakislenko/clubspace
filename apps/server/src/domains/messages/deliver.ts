import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import {
    NotificationTypeEnum,
    PrismaService,
    UserStatus,
} from '../../infrastructure/prisma'
import { type RoleName, SPORT_LEADS } from '../../shared/decorators/roles.decorator'
import { ownGroupsWhere } from '../../shared/services/rbac.service'
import { escapeHtml } from '../../shared/utils/escape-html'
import { TrialLimitsService } from '../billing/services/trial-limits.service'
import { EmailTemplatesService } from '../email-templates/services/email-templates.service'
import {
    type GuardianRoute,
    guardianTopic,
    loadGuardianRoutes,
} from '../notifications/guardian-routing'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { NotificationsService } from '../notifications/services/notifications.service'
import { RealtimeEmitter } from '../realtime/realtime-emitter.service'
import { type CallList, loadCallList } from '../retention/call-list'
import { CallListCacheService } from '../retention/call-list-cache.service'
import { dropMessageContact } from './contact'
import { type ClubMessageKind, clubMessageKind, type PushSkip } from './kinds'
import { loadCappedRecipients, lockClubMessages } from './limits'
import type { MessageScope, SegmentTarget } from './segment-where'
import { resolveSegmentUserIds } from './segments'
import { clubMessagesUnsubscribeUrl } from './unsubscribe-token'

const RECIPIENT_CHUNK = 500
const PUSH_MESSAGE_MAX = 200
// The copies of a whole-club message (a few thousand rows) in one transaction.
const RECIPIENTS_TX_TIMEOUT_MS = 30_000

export type PushPlan = {
    skip: Map<string, PushSkip | null>
    routes: Map<string, GuardianRoute>
    // People (recipients and guardians) who muted the club; filled for a
    // broadcast only — the other kinds pass the mute.
    muted: Set<string>
}

// What the push step does for each recipient, without writing anything (the
// compose preview shows it; delivery acts on it). A broadcast stops at the
// person's «Сообщения клуба» switch and the club mute; a child's copy goes
// to its confirmed guardians, each under their own switch and mute (the
// producer's recipient gates apply the same rule when it writes); then the
// daily broadcast cap; no device (own, or any remaining guardian's) =
// in-app and inbox only.
export const planPush = async (
    prisma: Pick<
        PrismaService,
        'guardianship' | 'notificationPreferences' | 'workspaceMember' | 'user' | 'clubMessageRecipient'
    >,
    p: { workspaceId: string; timezone: string; userIds: string[]; kind: ClubMessageKind; now: Date },
): Promise<PushPlan> => {
    const broadcast = p.kind === 'message.broadcast'
    const routes = await loadGuardianRoutes(prisma, p.userIds)
    const people = [
        ...new Set([...p.userIds, ...[...routes.values()].flatMap((r) => r.guardianIds)]),
    ]
    const [optedOutRows, mutedRows, withDevice, capped] = await Promise.all([
        broadcast && people.length > 0
            ? prisma.notificationPreferences.findMany({
                  where: { userId: { in: people }, clubMessagesEnabled: false },
                  select: { userId: true },
              })
            : [],
        broadcast && people.length > 0
            ? prisma.workspaceMember.findMany({
                  where: {
                      workspaceId: p.workspaceId,
                      userId: { in: people },
                      status: 'ACTIVE',
                      notificationsMuted: true,
                  },
                  select: { userId: true },
              })
            : [],
        people.length > 0
            ? prisma.user.findMany({
                  where: {
                      id: { in: people },
                      OR: [{ firebaseDevices: { some: {} } }, { webPushSubscriptions: { some: {} } }],
                  },
                  select: { id: true },
              })
            : [],
        broadcast
            ? loadCappedRecipients(prisma, {
                  workspaceId: p.workspaceId,
                  userIds: p.userIds,
                  now: p.now,
                  timezone: p.timezone,
              })
            : new Set<string>(),
    ])
    const optedOut = new Set(optedOutRows.map((r) => r.userId))
    const muted = new Set(mutedRows.map((r) => r.userId))
    const hasDevice = new Set(withDevice.map((u) => u.id))

    const skip = new Map<string, PushSkip | null>()
    for (const userId of p.userIds) {
        if (optedOut.has(userId)) {
            skip.set(userId, 'opted_out')
            continue
        }
        if (muted.has(userId)) {
            skip.set(userId, 'muted')
            continue
        }
        const route = routes.get(userId)
        let targets = [userId]
        if (route) {
            targets = route.guardianIds.filter((g) => !optedOut.has(g) && !muted.has(g))
            if (targets.length === 0) {
                skip.set(
                    userId,
                    route.guardianIds.some((g) => optedOut.has(g)) ? 'opted_out' : 'muted',
                )
                continue
            }
        }
        if (capped.has(userId)) skip.set(userId, 'cap')
        else if (!targets.some((t) => hasDevice.has(t))) skip.set(userId, 'no_device')
        else skip.set(userId, null)
    }
    return { skip, routes, muted }
}

// Who an e-mail copy goes to, per recipient: the recipient, or a child's
// confirmed guardians, with an address and «Сообщения клуба на e-mail» on.
// Nobody who muted the club gets a broadcast copy — a muted child, or one
// muted guardian while the other still gets it. Recipients nobody can be
// e-mailed for are left out (the preview counts the rest).
export const loadEmailTargets = async (
    prisma: Pick<PrismaService, 'user'>,
    userIds: string[],
    plan: PushPlan,
    kind: ClubMessageKind,
): Promise<Map<string, { userId: string; address: string }[]>> => {
    const broadcast = kind === 'message.broadcast'
    const eligible = userIds.filter((u) => !(broadcast && plan.skip.get(u) === 'muted'))
    const targetsOf = (u: string) =>
        (plan.routes.get(u)?.guardianIds ?? [u]).filter((t) => !(broadcast && plan.muted.has(t)))
    const ids = [...new Set(eligible.flatMap(targetsOf))]
    const people = ids.length
        ? await prisma.user.findMany({
              where: { id: { in: ids }, email: { not: null }, status: UserStatus.ACTIVE },
              select: {
                  id: true,
                  email: true,
                  notificationPreferences: { select: { clubMessagesEmailEnabled: true } },
              },
          })
        : []
    const address = new Map(
        people
            .filter((u) => u.email && u.notificationPreferences?.clubMessagesEmailEnabled !== false)
            .map((u) => [u.id, u.email as string]),
    )
    const out = new Map<string, { userId: string; address: string }[]>()
    for (const u of eligible) {
        const list = targetsOf(u).flatMap((t) => {
            const a = address.get(t)
            return a ? [{ userId: t, address: a }] : []
        })
        if (list.length > 0) out.set(u, list)
    }
    return out
}

export type DeliveryOptions = {
    // The scope and call list the request already resolved; the dispatcher
    // computes both from the author at send time.
    scope?: MessageScope
    callList?: () => Promise<CallList>
}

type Workspace = {
    id: string
    name: string
    ownerId: string
    timezone: string
    messagesEmailEnabled: boolean
}

// The only writer of ClubMessageRecipient rows
// (docs/design/2026-11-26-broadcast-and-direct-messages.md §4.1): claim, resolve
// the segment, write the in-app copies with the counters (under the club lock,
// with the per-recipient push cap read), then push + inbox through the
// producer and the e-mail copies.
@Injectable()
export class ClubMessageDeliveryService {
    private readonly logger = new Logger(ClubMessageDeliveryService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: NotificationProducerService,
        private readonly notifications: NotificationsService,
        private readonly templates: EmailTemplatesService,
        private readonly trialLimits: TrialLimitsService,
        private readonly realtime: RealtimeEmitter,
        private readonly callLists: CallListCacheService,
    ) {}

    // The author's reach at send time: club-wide for the owner, a super admin
    // or a sport lead; own groups for a coach or direction manager; null when
    // the author is gone or no longer staff (the message is then cancelled).
    async authorScope(workspace: Workspace, authorId: string | null): Promise<MessageScope | null> {
        if (!authorId) return null
        if (authorId === workspace.ownerId) return { groupIds: null }
        const author = await this.prisma.user.findUnique({
            where: { id: authorId },
            select: {
                isSuperAdmin: true,
                workspaceMemberships: {
                    where: { workspaceId: workspace.id, status: 'ACTIVE' },
                    select: { role: { select: { name: true } } },
                },
            },
        })
        if (!author) return null
        if (author.isSuperAdmin) return { groupIds: null }
        const role = author.workspaceMemberships[0]?.role?.name
        if (role && SPORT_LEADS.includes(role as RoleName)) return { groupIds: null }
        if (role !== 'coach') return null
        const groups = await this.prisma.group.findMany({
            where: { workspaceId: workspace.id, ...ownGroupsWhere(authorId) },
            select: { id: true },
        })
        return { groupIds: groups.map((g) => g.id) }
    }

    // Sends one SCHEDULED message. Returns false when someone else already
    // claimed it (or it was cancelled); the status flip is the dedupe.
    async deliver(messageId: string, now: Date, opts: DeliveryOptions = {}): Promise<boolean> {
        const claimed = await this.prisma.clubMessage.updateMany({
            where: { id: messageId, status: 'SCHEDULED' },
            data: { status: 'SENT', sentAt: now },
        })
        if (claimed.count === 0) return false
        const message = await this.prisma.clubMessage.findUniqueOrThrow({
            where: { id: messageId },
            include: {
                workspace: {
                    select: {
                        id: true,
                        name: true,
                        ownerId: true,
                        timezone: true,
                        messagesEmailEnabled: true,
                    },
                },
            },
        })
        const workspace = message.workspace
        const scope = opts.scope ?? (await this.authorScope(workspace, message.authorId))
        if (!scope) {
            await this.prisma.clubMessage.update({
                where: { id: messageId },
                data: { status: 'CANCELLED', sentAt: null },
            })
            // A «Связались» logged with it no longer happened.
            await dropMessageContact(this.prisma, this.callLists, message)
            this.logger.warn(`club message ${messageId}: author is no longer staff, cancelled`)
            this.realtime.invalidateCoalesced(workspace.id, ['messages'])
            return false
        }
        const target: SegmentTarget = {
            segment: message.segment,
            directionId: message.directionId,
            groupIds: message.groupIds,
            memberIds: message.memberIds,
        }
        const userIds = await resolveSegmentUserIds(this.prisma, {
            workspaceId: workspace.id,
            ownerId: workspace.ownerId,
            target,
            scope,
            now,
            callList: opts.callList ?? (() => loadCallList(this.prisma, { workspaceId: workspace.id, now })),
        })

        const kind = clubMessageKind(message)
        // The cap read and the copies under the club's lock, so two messages
        // sent at once can't both see a recipient under the daily cap; the
        // counters land with the copies, whatever happens to push and e-mail.
        const plan = await this.prisma.$transaction(
            async (tx) => {
                await lockClubMessages(tx, workspace.id)
                const planned = await planPush(tx, {
                    workspaceId: workspace.id,
                    timezone: workspace.timezone,
                    userIds,
                    kind,
                    now,
                })
                for (let i = 0; i < userIds.length; i += RECIPIENT_CHUNK) {
                    await tx.clubMessageRecipient.createMany({
                        data: userIds.slice(i, i + RECIPIENT_CHUNK).map((userId) => ({
                            messageId,
                            workspaceId: workspace.id,
                            userId,
                            pushSkip: planned.skip.get(userId) ?? null,
                        })),
                        skipDuplicates: true,
                    })
                }
                await tx.clubMessage.update({
                    where: { id: messageId },
                    data: {
                        recipientCount: userIds.length,
                        pushCount: userIds.filter((u) => planned.skip.get(u) === null).length,
                    },
                })
                return planned
            },
            { timeout: RECIPIENTS_TX_TIMEOUT_MS },
        )

        const guardians = userIds.flatMap((u) => plan.routes.get(u)?.guardianIds ?? [])
        const addressed = [...new Set([...userIds, ...guardians])]
        const emailed: string[] = []
        try {
            // Inbox rows for everyone reachable; a push goes out where a device is.
            const inbox = userIds.filter((u) => {
                const s = plan.skip.get(u)
                return s === null || s === 'no_device'
            })
            const text =
                message.body.length > PUSH_MESSAGE_MAX
                    ? `${message.body.slice(0, PUSH_MESSAGE_MAX)}…`
                    : message.body
            if (inbox.length > 0) {
                await this.producer.writeMany(
                    inbox.map((userId) => ({
                        userId,
                        topic: message.title,
                        message: text,
                        metadata: { kind, workspaceId: workspace.id, messageId },
                        ...(kind === 'message.broadcast' ? { category: 'clubMessagesEnabled' as const } : {}),
                    })),
                )
            }
            if (message.withEmail && workspace.messagesEmailEnabled) {
                await this.sendEmails(message, workspace, userIds, plan, kind, now, emailed)
            }
        } finally {
            // What went out is recorded even when a later step failed.
            if (emailed.length > 0) {
                await this.prisma.clubMessageRecipient.updateMany({
                    where: { messageId, userId: { in: emailed } },
                    data: { emailedAt: now },
                })
                await this.prisma.clubMessage.update({
                    where: { id: messageId },
                    data: { emailCount: emailed.length },
                })
            }
            this.realtime.invalidateUsersInWorkspace(addressed, workspace.id, ['club-messages'])
            this.realtime.invalidateUsers(addressed, ['notifications'])
            this.realtime.invalidateCoalesced(workspace.id, ['messages'])
        }
        return true
    }

    // E-mail copies: to the recipient, or a child's confirmed guardians, with
    // an address and the e-mail switch on; nobody who muted the club gets a
    // broadcast copy. A trial club's allowance is taken per e-mail; once spent
    // the rest stay unsent. Adds to `emailed` each recipient (student) a copy
    // went to, as it goes, so a failure midway keeps what was sent.
    private async sendEmails(
        message: { id: string; title: string; body: string },
        workspace: Workspace,
        userIds: string[],
        plan: PushPlan,
        kind: ClubMessageKind,
        now: Date,
        emailed: string[],
    ): Promise<void> {
        const targets = await loadEmailTargets(this.prisma, userIds, plan, kind)
        const secret = environment.encryptionKey
        for (const [userId, addresses] of targets) {
            const route = plan.routes.get(userId)
            let sent = false
            for (const { userId: target, address } of addresses) {
                if (!(await this.trialLimits.consumeTrialEmail(workspace.id, now))) {
                    if (sent) emailed.push(userId)
                    return
                }
                const title = route ? guardianTopic(route, message.title) : message.title
                const unsubscribeUrl = clubMessagesUnsubscribeUrl(environment.rootUrl, target, secret)
                try {
                    const { content } = await this.templates.getTemplate({
                        key: 'club-message',
                        data: {
                            clubName: escapeHtml(workspace.name),
                            title: escapeHtml(title),
                            bodyHtml: escapeHtml(message.body).replace(/\r?\n/g, '<br />'),
                            appLinkHtml: environment.appUrl
                                ? `<a href="${escapeHtml(environment.appUrl)}" style="display: inline-block; padding: 12px 24px; background: #5b58d9; color: #fff; text-decoration: none; border-radius: 999px; font-size: 14px; font-weight: 700;">Открыть в приложении</a>`
                                : '',
                            unsubscribeUrl: escapeHtml(unsubscribeUrl),
                        },
                    })
                    await this.notifications.sendNotification({
                        userId: target,
                        identity: address,
                        type: NotificationTypeEnum.EMAIL,
                        topic: `${title} — ${workspace.name}`.slice(0, 255),
                        message: content,
                        metadata: {
                            kind,
                            workspaceId: workspace.id,
                            messageId: message.id,
                            unsubscribeUrl,
                            ...(route ? { dependentId: userId } : {}),
                        },
                    })
                    sent = true
                } catch (error) {
                    this.logger.error(
                        `club message ${message.id}: e-mail failed`,
                        error instanceof Error ? error.stack : String(error),
                    )
                }
            }
            if (sent) emailed.push(userId)
        }
    }
}
