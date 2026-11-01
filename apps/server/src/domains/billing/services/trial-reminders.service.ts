import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { escapeHtml } from '../../../shared/utils/escape-html'
import { pluralRu } from '../../../shared/utils/plural-ru'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { claimDispatchMany } from '../../scheduler/dispatch-claims'
import { addDays } from '../billing-rules'
import { dueTrialReminder } from '../trial-limits'
import { PlatformBillingService } from './platform-billing.service'

const DAY_MS = 24 * 60 * 60 * 1000
const RUB = new Intl.NumberFormat('ru-RU')
const DATE = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

// The dedupe key of one reminder: the club, the trial it belongs to (its end,
// so a trial the console extends is reminded again) and the trial day.
export const TRIAL_REMINDER_KIND = 'platformBilling.trialReminder'
const RUN_KIND = `${TRIAL_REMINDER_KIND}.run`

// Trial → paid: on the PLATFORM_TRIAL_REMINDER_DAYS days of a trial (23 and
// 28 of 30 by default) the owner gets an e-mail and a push with what the
// first period will cost (the quote the charge will use) and what happens
// next — the saved card is charged at the end, or the club must pay on
// «Тариф» before the grace period runs out. Each reminder goes out once
// (NotificationDispatchLog claim); a club that already paid its first period
// gets none. Runs with the hourly autopay pass.
@Injectable()
export class TrialRemindersService {
    private readonly logger = new Logger(TrialRemindersService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
        private readonly producer: NotificationProducerService,
        private readonly notifications: NotificationsService,
    ) {}

    async run(now: Date = new Date()): Promise<number> {
        const { enabled, trialDays, trial } = environment.billing
        if (!enabled || trial.reminderDays.length === 0) return 0
        const earliest = trial.reminderDays[0]
        const candidates = await this.prisma.workspaceBilling.findMany({
            where: {
                status: 'TRIAL',
                trialEndsAt: { gt: now, lte: addDays(now, trialDays - earliest) },
            },
            select: {
                workspaceId: true,
                trialEndsAt: true,
                currentPeriodEnd: true,
            },
        })

        let sent = 0
        for (const row of candidates) {
            const trialEndsAt = row.trialEndsAt!
            // Paid during the trial: nothing to remind about.
            if (row.currentPeriodEnd && row.currentPeriodEnd > trialEndsAt) continue
            const due = dueTrialReminder(trialEndsAt, trial.reminderDays, trialDays, now)
            if (!due) continue
            const refOf = (day: number) =>
                `${row.workspaceId}:${trialEndsAt.toISOString()}:${day}`
            // Claim every day already past, send only the latest: a trial
            // that reaches day 28 without the day-23 reminder gets one message.
            const won = await claimDispatchMany(this.prisma, RUN_KIND, due.passed.map(refOf))
            if (!won.has(refOf(due.day))) continue
            try {
                await this.notify(row.workspaceId, trialEndsAt, refOf(due.day), now)
                sent += 1
            } catch (err) {
                this.logger.error(
                    `Trial reminder for workspace ${row.workspaceId} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return sent
    }

    private async notify(workspaceId: string, trialEndsAt: Date, refId: string, now: Date) {
        const workspace = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: workspaceId },
            select: { name: true, ownerId: true },
        })
        const [owner, row, quote] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: workspace.ownerId },
                select: { email: true },
            }),
            this.billing.getBilling(workspaceId),
            this.billing.quoteWorkspaceBilling(workspaceId, { now }),
        ])
        const daysLeft = Math.max(1, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS))
        const left = `${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`
        const endDate = DATE.format(trialEndsAt)
        const card = row.paymentMethodId && (row.autopayEnabled ?? true)
        const next = card
            ? `${endDate} спишем ${RUB.format(quote.total)} ₽ с карты ${
                  row.paymentMethodTitle ?? `*${row.paymentMethodCardLast4 ?? ''}`
              } автоматически — ничего делать не нужно.`
            : `Оплатите тариф на странице «Тариф» до ${endDate}, чтобы клуб продолжил работать. Без оплаты через ${environment.billing.graceDays} ${pluralRu(environment.billing.graceDays, 'день', 'дня', 'дней')} после окончания пробного периода клуб будет приостановлен.`
        const topic = `Пробный период «${workspace.name}» закончится через ${left}`
        const summary = `Пробный период клуба «${workspace.name}» заканчивается ${endDate}. Первый платёж — ${RUB.format(quote.total)} ₽. ${next}`
        const link = environment.adminUrl
            ? `${environment.adminUrl.replace(/\/+$/, '')}/workspace/${workspaceId}/billing`
            : null

        await this.producer.notifyUser({
            userId: workspace.ownerId,
            kind: TRIAL_REMINDER_KIND,
            refId,
            topic,
            message: summary,
            link,
            metadata: { workspaceId },
        })
        if (!owner?.email) return
        const lines = [...quote.lines, ...quote.discounts.map((d) => ({ ...d, amount: -d.amount }))]
            .map(
                (l) =>
                    `<tr><td>${escapeHtml(l.title)}</td><td style="text-align:right">${RUB.format(l.amount)} ₽</td></tr>`,
            )
            .join('')
        await this.notifications.sendNotification({
            userId: workspace.ownerId,
            type: 'EMAIL',
            identity: owner.email,
            topic,
            message:
                `<p>${escapeHtml(`Пробный период клуба «${workspace.name}» заканчивается ${endDate}.`)}</p>` +
                `<table>${lines}<tr><td><b>Итого</b></td><td style="text-align:right"><b>${RUB.format(quote.total)} ₽</b></td></tr></table>` +
                `<p>${escapeHtml(next)}</p>` +
                (link ? `<p><a href="${escapeHtml(link)}">Открыть «Тариф»</a></p>` : ''),
            metadata: { kind: TRIAL_REMINDER_KIND, workspaceId },
        })
    }
}
