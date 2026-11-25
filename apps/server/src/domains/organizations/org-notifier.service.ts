import { Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { escapeHtml } from '../../shared/utils/escape-html'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../../features/send-notification/send-notification.feature'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'

// Membership notices of the federation hub
// (docs/design/2026-11-26-federation-hub-mvp.md §3.4). Never throws: the
// decision they report is already saved.
//
// - `org.club_invited` → the club owner: inbox + push + e-mail. Mute-exempt —
//   a decision about the club's data, not club chatter.
// - `org.club_joined` / `org.club_left` → the org admins (inbox + push).
@Injectable()
export class OrgNotifierService {
    private readonly logger = new Logger(OrgNotifierService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: NotificationProducerService,
        private readonly bus: FeaturesBus,
    ) {}

    async notifyClubInvited(p: {
        linkId: string
        invitedAt: Date
        organization: { id: string; name: string }
        club: { workspaceId: string; name: string; ownerId: string }
    }): Promise<void> {
        const topic = `Федерация «${p.organization.name}» приглашает клуб`
        const message = `Федерация «${p.organization.name}» приглашает клуб «${p.club.name}». Принять или отклонить приглашение может владелец клуба в админке: «Настройки → Федерация».`
        const metadata = {
            organizationId: p.organization.id,
            workspaceId: p.club.workspaceId,
            linkId: p.linkId,
        }
        try {
            await this.producer.notifyUser({
                userId: p.club.ownerId,
                kind: 'org.club_invited',
                // A re-invite of the same link is a new notice.
                refId: `${p.linkId}:${p.invitedAt.getTime()}`,
                topic,
                message,
                metadata,
            })
        } catch (error) {
            this.warn('invite push', error)
        }
        const settingsUrl = environment.adminUrl
            ? `${environment.adminUrl}/workspace/${p.club.workspaceId}/settings/federation`
            : null
        try {
            await this.bus.execute<SendNotificationFeature, SendNotificationFeatureResponse>(
                new SendNotificationFeature({
                    userId: p.club.ownerId,
                    topic,
                    message: [
                        `<p>Федерация «${escapeHtml(p.organization.name)}» приглашает клуб «${escapeHtml(p.club.name)}» в ClubSpace.</p>`,
                        '<p>Если клуб вступит, федерация увидит название, город, логотип и контакты клуба, общие цифры (ученики, активные, посещения, новички, удержание) и пояса учеников, которые сами на это согласятся. Деньги клуба федерация не видит, пока вы не откроете каждую цифру отдельно.</p>',
                        settingsUrl
                            ? `<p>Принять или отклонить: <a href="${escapeHtml(settingsUrl)}">Настройки → Федерация</a>.</p>`
                            : '<p>Принять или отклонить: админка клуба, «Настройки → Федерация».</p>',
                    ].join(''),
                    types: [NotificationTypeEnum.EMAIL],
                    forced: true,
                    metadata: { ...metadata, kind: 'org.club_invited' },
                }),
            )
        } catch (error) {
            this.warn('invite e-mail', error)
        }
    }

    // «Вас добавили в команду федерации»: e-mail to a new org staff member
    // (sign-in is e-mail OTP, so the account works at once).
    async notifyMemberAdded(p: {
        userId: string
        organization: { id: string; name: string }
        role: 'ORG_ADMIN' | 'ORG_COACH'
    }): Promise<boolean> {
        const roleLabel = p.role === 'ORG_ADMIN' ? 'администратор' : 'тренер федерации'
        const consoleUrl = environment.adminUrl
            ? `${environment.adminUrl}/org/${p.organization.id}`
            : null
        try {
            const result = await this.bus.execute<
                SendNotificationFeature,
                SendNotificationFeatureResponse
            >(
                new SendNotificationFeature({
                    userId: p.userId,
                    topic: `Вас добавили в команду федерации «${p.organization.name}»`,
                    message: [
                        `<p>Вас добавили в команду федерации «${escapeHtml(p.organization.name)}» в ClubSpace. Роль: ${roleLabel}.</p>`,
                        consoleUrl
                            ? `<p>Войдите по этому адресу почты: <a href="${escapeHtml(consoleUrl)}">${escapeHtml(consoleUrl)}</a>.</p>`
                            : '<p>Войдите в админку ClubSpace по этому адресу почты.</p>',
                    ].join(''),
                    types: [NotificationTypeEnum.EMAIL],
                    forced: true,
                    metadata: { kind: 'org.member_added', organizationId: p.organization.id },
                }),
            )
            return result.success
        } catch (error) {
            this.warn('member e-mail', error)
            return false
        }
    }

    async notifyOrgAdmins(p: {
        organizationId: string
        kind: 'org.club_joined' | 'org.club_left'
        refId: string
        topic: string
        message: string
        workspaceId: string
    }): Promise<void> {
        try {
            const admins = await this.prisma.organizationMember.findMany({
                where: { organizationId: p.organizationId, role: 'ORG_ADMIN' },
                select: { userId: true },
            })
            for (const { userId } of admins) {
                await this.producer.notifyUser({
                    userId,
                    kind: p.kind,
                    refId: `${p.refId}:${userId}`,
                    topic: p.topic,
                    message: p.message,
                    metadata: {
                        organizationId: p.organizationId,
                        workspaceId: p.workspaceId,
                    },
                })
            }
        } catch (error) {
            this.warn(p.kind, error)
        }
    }

    private warn(what: string, error: unknown): void {
        this.logger.warn(
            `org notice (${what}) failed: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
}
