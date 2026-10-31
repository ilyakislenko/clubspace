import { Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'

import { environment } from '../../../environments/environment'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../../../features/send-notification/send-notification.feature'
import { NotificationTypeEnum, PrismaService } from '../../../infrastructure/prisma'
import { WORKSPACE_ADMINS } from '../../../shared/decorators/roles.decorator'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { RolesEnum } from '../../../shared/interfaces/shared.intefaces'
import { escapeHtml } from '../../../shared/utils/escape-html'
import { PlatformBillingService } from '../../billing/services/platform-billing.service'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'
import { appLinksHtml, buildAppLinks } from '../invite-links'

type JoinWorkspaceRef = { id: string; name: string; ownerId: string }

export type JoinOutcome =
    | { kind: 'owner' }
    | {
          kind: 'existing'
          status: 'ACTIVE' | 'INVITED' | 'BLOCKED' | 'SUSPENDED'
          membershipId: string
      }
    | { kind: 'created'; status: 'ACTIVE' | 'INVITED'; membershipId: string }

// Join-request notifications a single club gets per hour, however many people
// ask. The sign-in e-mail path is unauthenticated and a club key is public, so
// without a cap anyone could flood the owner's inbox and e-mail.
const NOTIFY_CAP_PER_HOUR = 20
const NOTIFY_WINDOW_MS = 60 * 60 * 1000
const NOTIFY_LOG_KIND = 'join-request-notice'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// A join request IS a WorkspaceMember row (INVITED = waiting for an admin,
// BLOCKED = turned down), so rosters keep keying on User. This service is the
// one place that creates it — from the join code and from the sign-in e-mail
// flow — and tells the club's staff about it.
@Injectable()
export class JoinRequestService {
    private readonly logger = new Logger(JoinRequestService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
        private readonly featuresBus: FeaturesBus,
        private readonly billing: PlatformBillingService,
    ) {}

    // «Принимать без подтверждения» stops at the plan's member limit: past
    // it the person is filed as a normal pending request, and the admin who
    // approves it is the one told about the limit.
    private async canAutoApprove(workspaceId: string): Promise<boolean> {
        const { remaining } = await this.billing.remaining(workspaceId, 'members')
        return remaining !== 0
    }

    async findExisting(
        userId: string,
        ws: JoinWorkspaceRef,
    ): Promise<JoinOutcome | null> {
        // The owner has no WorkspaceMember row — never create one for them.
        if (ws.ownerId === userId) return { kind: 'owner' }

        const existing = await this.prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId: ws.id } },
            select: { id: true, status: true },
        })
        if (!existing) return null
        return {
            kind: 'existing',
            status: existing.status,
            membershipId: existing.id,
        }
    }

    // `audience` is who hears about it. The code path (a signed-in person)
    // tells the owner and the admins; the unauthenticated sign-in e-mail path
    // tells only the owner, so a public club key can't be used to ping every
    // admin and head coach.
    async requestMembership(p: {
        userId: string
        workspace: JoinWorkspaceRef
        autoApprove: boolean
        audience: 'staff' | 'owner'
    }): Promise<JoinOutcome> {
        const found = await this.findExisting(p.userId, p.workspace)
        if (found?.kind === 'existing' && found.status === 'INVITED') {
            // Asked earlier, and the club has since switched on «принимать без
            // подтверждения»: coming back with the code settles it now rather
            // than leaving the request waiting for an admin.
            if (p.autoApprove && (await this.canAutoApprove(p.workspace.id))) {
                return this.approveWaiting(p.userId, p.workspace, found)
            }
        }
        if (found) return found

        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })
        if (!role) {
            throw new NotFoundError({
                message:
                    'Базовая роль участника не найдена (клуб не до конца инициализирован)',
            })
        }

        const status =
            p.autoApprove && (await this.canAutoApprove(p.workspace.id))
                ? 'ACTIVE'
                : 'INVITED'
        let membershipId: string
        try {
            const created = await this.prisma.workspaceMember.create({
                data: {
                    status,
                    userId: p.userId,
                    workspaceId: p.workspace.id,
                    roleId: role.id,
                },
                select: { id: true },
            })
            membershipId = created.id
        } catch (err) {
            // A concurrent request (double tap, two devices) can pass the
            // check above and then collide on unique(userId, workspaceId).
            // The membership exists: report it, don't notify twice.
            if (!isP2002(err)) throw err
            const raced = await this.findExisting(p.userId, p.workspace)
            if (raced) return raced
            throw err
        }

        // Admins' pending list updates live.
        this.realtime.invalidate(p.workspace.id, ['members'])
        if (status === 'ACTIVE') {
            this.realtime.joinWorkspaceRoom([p.userId], p.workspace.id)
        }

        await this.notifyStaff({
            userId: p.userId,
            workspace: p.workspace,
            membershipId,
            status,
            audience: p.audience,
        })

        return { kind: 'created', status, membershipId }
    }

    // INVITED -> ACTIVE for someone who is already waiting. The role on the
    // row stays as it is. Guarded on the status so a concurrent admin decision
    // (approve/reject) wins and is reported as it stands.
    private async approveWaiting(
        userId: string,
        ws: JoinWorkspaceRef,
        waiting: Extract<JoinOutcome, { kind: 'existing' }>,
    ): Promise<JoinOutcome> {
        const { count } = await this.prisma.workspaceMember.updateMany({
            where: { id: waiting.membershipId, status: 'INVITED' },
            data: { status: 'ACTIVE' },
        })
        if (count === 0) {
            return (await this.findExisting(userId, ws)) ?? waiting
        }
        this.realtime.invalidate(ws.id, ['members'])
        this.realtime.joinWorkspaceRoom([userId], ws.id)
        return {
            kind: 'created',
            status: 'ACTIVE',
            membershipId: waiting.membershipId,
        }
    }

    // The applicant was approved: inbox entry plus an e-mail. E-mail is the
    // channel that actually reaches them — a pending user has not been asked
    // for push permission yet (that happens once they are in a club).
    async notifyApproved(p: {
        userId: string
        workspaceId: string
        workspaceName: string
        membershipId: string
    }): Promise<void> {
        try {
            await this.notifications.notifyUser({
                userId: p.userId,
                kind: 'member.approved',
                refId: p.membershipId,
                topic: `Вас приняли в клуб «${p.workspaceName}»`,
                message: 'Откройте приложение — клуб уже доступен.',
                metadata: { workspaceId: p.workspaceId },
            })
        } catch (error) {
            this.warn('approval inbox entry', error)
        }

        try {
            await this.featuresBus.execute<
                SendNotificationFeature,
                SendNotificationFeatureResponse
            >(
                new SendNotificationFeature({
                    userId: p.userId,
                    topic: `Вас приняли в клуб «${p.workspaceName}»`,
                    message: {
                        htmlTemplateKey: 'member-approved',
                        data: {
                            workspaceName: escapeHtml(p.workspaceName),
                            appUrl: environment.appUrl ?? '',
                            appLinksHtml: appLinksHtml(
                                buildAppLinks({
                                    appUrl: environment.appUrl ?? '',
                                    appStoreUrl: environment.appStoreUrl,
                                    playStoreUrl: environment.playStoreUrl,
                                    ruStoreUrl: environment.ruStoreUrl,
                                }),
                            ),
                        },
                    },
                    types: [NotificationTypeEnum.EMAIL],
                    forced: true,
                    metadata: {
                        kind: 'member-approved',
                        workspaceId: p.workspaceId,
                    },
                }),
            )
        } catch (error) {
            this.warn('approval e-mail', error)
        }
    }

    // Never throws: a failed notification must not fail a join or a sign-up.
    private async notifyStaff(p: {
        userId: string
        workspace: JoinWorkspaceRef
        membershipId: string
        status: 'ACTIVE' | 'INVITED'
        audience: 'staff' | 'owner'
    }): Promise<void> {
        try {
            const { workspace: ws } = p
            if (!(await this.claimNotifySlot(ws.id, p.membershipId))) {
                this.logger.warn(
                    `Join-request notifications capped for workspace ${ws.id}`,
                )
                return
            }

            const applicant = await this.prisma.user.findUnique({
                where: { id: p.userId },
                select: { email: true, firstname: true, lastname: true },
            })
            const name = [applicant?.firstname, applicant?.lastname]
                .map((part) => part?.trim())
                .filter(Boolean)
                .join(' ')
            const email = applicant?.email ?? ''
            const who = name ? `${name} (${email})` : email

            const admins =
                p.audience === 'staff'
                    ? await this.prisma.workspaceMember.findMany({
                          where: {
                              workspaceId: ws.id,
                              status: 'ACTIVE',
                              role: { name: { in: WORKSPACE_ADMINS } },
                          },
                          select: { userId: true },
                      })
                    : []
            const recipients = [
                ...new Set([ws.ownerId, ...admins.map((a) => a.userId)]),
            ].filter((id) => id !== p.userId)

            const pending = p.status === 'INVITED'
            // One failing recipient must not skip the others or the e-mail.
            for (const recipientId of recipients) {
                try {
                    await this.notifications.notifyUser({
                        userId: recipientId,
                        kind: pending
                            ? 'member.join_requested'
                            : 'member.joined',
                        refId: `${p.membershipId}:${recipientId}`,
                        topic: pending
                            ? `Новая заявка в «${ws.name}»`
                            : `Новый участник в «${ws.name}»`,
                        message: pending
                            ? `${who} хочет вступить в клуб`
                            : `${who} — новый участник клуба (вступил по коду)`,
                        metadata: {
                            workspaceId: ws.id,
                            applicantUserId: p.userId,
                            membershipId: p.membershipId,
                        },
                    })
                } catch (error) {
                    this.warn('staff inbox entry', error)
                }
            }

            if (pending) {
                try {
                    await this.emailOwner({ ws, applicantEmail: email })
                } catch (error) {
                    this.warn('owner e-mail', error)
                }
            }
        } catch (error) {
            this.warn('staff notification', error)
        }
    }

    // At most NOTIFY_CAP_PER_HOUR notified requests per club per hour, counted
    // in the dispatch log (kind + `<workspaceId>:<membershipId>`). The request
    // itself is always filed; only the pings stop.
    private async claimNotifySlot(
        workspaceId: string,
        membershipId: string,
    ): Promise<boolean> {
        const recent = await this.prisma.notificationDispatchLog.count({
            where: {
                kind: NOTIFY_LOG_KIND,
                refId: { startsWith: `${workspaceId}:` },
                dispatchedAt: {
                    gte: new Date(Date.now() - NOTIFY_WINDOW_MS),
                },
            },
        })
        if (recent >= NOTIFY_CAP_PER_HOUR) return false
        try {
            await this.prisma.notificationDispatchLog.create({
                data: {
                    kind: NOTIFY_LOG_KIND,
                    refId: `${workspaceId}:${membershipId}`,
                },
            })
        } catch (e) {
            // Already logged (a retry of the same request): not a new ping.
            if (!isP2002(e)) throw e
        }
        return true
    }

    private async emailOwner(p: {
        ws: JoinWorkspaceRef
        applicantEmail: string
    }): Promise<void> {
        await this.featuresBus.execute<
            SendNotificationFeature,
            SendNotificationFeatureResponse
        >(
            new SendNotificationFeature({
                userId: p.ws.ownerId,
                topic: `Новая заявка в ${p.ws.name}`,
                message: {
                    htmlTemplateKey: 'pending-member',
                    data: {
                        workspaceName: escapeHtml(p.ws.name),
                        userEmail: escapeHtml(p.applicantEmail),
                        // '#' when ADMIN_URL is not configured: the e-mail's text
                        // still tells the owner where to look.
                        adminUrl: environment.adminUrl
                            ? `${environment.adminUrl}/workspace/${p.ws.id}/users`
                            : '#',
                    },
                },
                types: [NotificationTypeEnum.EMAIL],
                forced: true,
                metadata: {
                    kind: 'pending-member',
                    workspaceId: p.ws.id,
                    applicantEmail: p.applicantEmail,
                },
            }),
        )
    }

    private warn(what: string, error: unknown) {
        this.logger.warn(
            `Failed to send ${what}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        )
    }
}
