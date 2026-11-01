import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { escapeHtml } from '../../shared/utils/escape-html'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { NotificationsService } from '../notifications/services/notifications.service'
import { findClubsDue } from '../scheduler/clubs-due'
import { claimDispatch, releaseDispatch } from '../scheduler/dispatch-claims'
import {
    type AnalyticsScope,
    loadChurnReport,
    loadCohortReport,
    loadForecastReport,
    loadOccupancyReport,
} from './analytics-reports'
import { analyticsDigestSlot, buildWeeklyDigest, type WeeklyDigest } from './digest-rules'

export const ANALYTICS_DIGEST_KIND = 'analytics.digest'
const RUN_KIND = `${ANALYTICS_DIGEST_KIND}.run`
const EMAIL_KIND = `${ANALYTICS_DIGEST_KIND}.email`
const WHOLE_CLUB: AnalyticsScope = { groupIds: null, includeGroupless: true }

// Monday-morning «Аналитика за неделю» to the owner and the club's admins:
// push + e-mail, 3 facts and 3 actions (digest-rules.ts) over the whole
// club's snapshots. Once per club per week: the run is claimed on the club's
// Monday date, each recipient's push and e-mail on their own keys. Opt-out:
// NotificationPreferences.analyticsDigestEnabled.
@Injectable()
export class AnalyticsDigestService {
    private readonly logger = new Logger(AnalyticsDigestService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: NotificationProducerService,
        private readonly notifications: NotificationsService,
    ) {}

    async run(now: Date = new Date()): Promise<{ workspaces: number; sent: number }> {
        const clubs = await findClubsDue(this.prisma, (tz) => analyticsDigestSlot(now, tz).due)
        let workspaces = 0
        let sent = 0
        for (const ws of clubs) {
            const { weekYmd } = analyticsDigestSlot(now, ws.timezone)
            const refId = `${ws.id}:${weekYmd}`
            if (!(await claimDispatch(this.prisma, RUN_KIND, refId))) continue
            workspaces += 1
            try {
                sent += await this.digestWorkspace(ws, weekYmd, now)
            } catch (err) {
                // The next run retries; recipients already reached keep their keys.
                await releaseDispatch(this.prisma, RUN_KIND, refId)
                this.logger.error(
                    `Analytics digest of workspace ${ws.id} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return { workspaces, sent }
    }

    private async digestWorkspace(
        ws: { id: string; name: string; ownerId: string },
        weekYmd: string,
        now: Date,
    ): Promise<number> {
        const p = { workspaceId: ws.id, scope: WHOLE_CLUB, now }
        const [churn, forecast, occupancy, cohorts, admins] = await Promise.all([
            loadChurnReport(this.prisma, p),
            loadForecastReport(this.prisma, p),
            loadOccupancyReport(this.prisma, p),
            loadCohortReport(this.prisma, p),
            this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: ws.id,
                    status: 'ACTIVE',
                    role: { name: { in: WORKSPACE_ADMINS } },
                },
                select: { userId: true },
            }),
        ])
        // Nothing to say about a club without students yet.
        if (forecast.members === 0) return 0
        const digest = buildWeeklyDigest({ churn, forecast, occupancy, cohorts })

        const recipientIds = [...new Set([ws.ownerId, ...admins.map((a) => a.userId)])]
        const [users, optedOut] = await Promise.all([
            this.prisma.user.findMany({
                where: { id: { in: recipientIds }, deletedAt: null },
                select: { id: true, email: true },
            }),
            this.prisma.notificationPreferences.findMany({
                where: { userId: { in: recipientIds }, analyticsDigestEnabled: false },
                select: { userId: true },
            }),
        ])
        const off = new Set(optedOut.map((o) => o.userId))
        const base = environment.adminUrl
            ? `${environment.adminUrl.replace(/\/+$/, '')}/workspace/${ws.id}`
            : null
        const topic = `${ws.name}: аналитика за неделю`

        let sent = 0
        for (const u of users) {
            if (off.has(u.id)) continue
            const refId = `${ws.id}:${u.id}:${weekYmd}`
            const pushed = await this.producer.notifyUser({
                userId: u.id,
                kind: ANALYTICS_DIGEST_KIND,
                refId,
                topic,
                message: `${digest.facts[0]}. Что сделать: ${digest.actions[0]?.text ?? 'откройте «Аналитику»'}`,
                link: base ? `${base}/analytics` : null,
                workspaceId: ws.id,
                metadata: { workspaceId: ws.id, weekYmd },
            })
            let mailed = false
            if (u.email && (await claimDispatch(this.prisma, EMAIL_KIND, refId))) {
                await this.notifications.sendNotification({
                    userId: u.id,
                    type: 'EMAIL',
                    identity: u.email,
                    topic,
                    message: renderDigestHtml(ws.name, digest, base),
                    metadata: { kind: ANALYTICS_DIGEST_KIND, workspaceId: ws.id },
                })
                mailed = true
            }
            if (pushed || mailed) sent += 1
        }
        return sent
    }
}

export const renderDigestHtml = (
    clubName: string,
    digest: WeeklyDigest,
    base: string | null,
): string => {
    const link = (path: string, label: string) =>
        base ? ` <a href="${escapeHtml(`${base}/${path}`)}">${escapeHtml(label)}</a>` : ''
    return (
        `<p>${escapeHtml(`Аналитика клуба «${clubName}» за неделю.`)}</p>` +
        `<p><b>Факты</b></p><ul>${digest.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` +
        `<p><b>Что сделать</b></p><ol>${digest.actions
            .map((a) => `<li>${escapeHtml(a.text)}${link(a.path, 'Открыть')}</li>`)
            .join('')}</ol>` +
        `<p style="color:#666">Отключить сводку можно в настройках уведомлений.</p>`
    )
}
