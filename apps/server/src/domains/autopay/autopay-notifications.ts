import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { escapeHtml } from '../../shared/utils/escape-html'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { pluralRu } from '../../shared/utils/plural-ru'
import { formatMoney } from '../analytics/money'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { NotificationsService } from '../notifications/services/notifications.service'
import { findAutopayStaffRecipients } from './autopay-recipients'

// Notification kinds (docs/design/2026-11-15-member-autopay.md §3.6). All under
// `subscription.` — mute-exempt by prefix, no opt-out category (money).
export const AUTOPAY_KINDS = {
    reminder: 'subscription.autopay_reminder',
    failed: 'subscription.autopay_failed',
    termsChanged: 'subscription.autopay_terms_changed',
    cancelled: 'subscription.autopay_cancelled',
    staffAlert: 'subscription.autopay_staff_alert',
} as const

// «4 000 ₽ за 30 дней» / «4 000 ₽ за 12 занятий на 30 дней».
export const autopayTermsText = (t: {
    amount: number
    currency: string
    durationDays: number
    classCount: number | null
}): string => {
    const days = `${t.durationDays} ${pluralRu(t.durationDays, 'день', 'дня', 'дней')}`
    const money = formatMoney(t.amount, t.currency)
    return t.classCount === null
        ? `${money} за ${days}`
        : `${money} за ${t.classCount} ${pluralRu(t.classCount, 'занятие', 'занятия', 'занятий')} на ${days}`
}

// «Завтра, 14 декабря» / «Через 3 дня, 14 декабря» / «14 декабря».
const whenText = (due: Date, now: Date, tz: string): string => {
    const date = formatRuDate(due, tz)
    const days = Math.round(
        (Date.parse(`${ymd(due, tz)}T00:00:00Z`) - Date.parse(`${ymd(now, tz)}T00:00:00Z`)) /
            (24 * 60 * 60 * 1000),
    )
    if (days === 1) return `Завтра, ${date}`
    if (days > 1) return `Через ${days} ${pluralRu(days, 'день', 'дня', 'дней')}, ${date}`
    return `Сегодня, ${date}`
}

const ymd = (d: Date, tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)

type MemberNotice = {
    userId: string
    workspaceId: string
    kind: string
    refId: string
    topic: string
    message: string
    autopayId: string
    // An e-mail copy too (a push may be off): reminder, decline, terms change,
    // cancellation.
    email: boolean
    // A cancellation is the member's written confirmation of a refusal
    // (376-ФЗ): it goes out even with the abonement section off.
    ungated?: boolean
}

// Member and staff notices of member autopay. Best-effort: a failed notice is
// logged and never undoes the bookkeeping that triggered it (as the platform's
// notifyChargeFailed). Each notice is deduplicated by (kind, refId).
@Injectable()
export class AutopayNotificationsService {
    private readonly logger = new Logger(AutopayNotificationsService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: NotificationProducerService,
        private readonly notifications: NotificationsService,
    ) {}

    async reminder(p: {
        autopayId: string
        anchorId: string
        userId: string
        workspaceId: string
        clubName: string
        planName: string
        amount: number
        currency: string
        lower: boolean
        cardLast4: string | null
        dueAt: Date
        now: Date
        tz: string
    }) {
        const card = p.cardLast4 ? `с карты •• ${p.cardLast4}` : 'с сохранённого способа оплаты'
        await this.toMember({
            userId: p.userId,
            workspaceId: p.workspaceId,
            kind: AUTOPAY_KINDS.reminder,
            refId: `${p.autopayId}:${p.anchorId}`,
            autopayId: p.autopayId,
            email: true,
            topic: 'Скоро автоплатёж',
            message: `${whenText(p.dueAt, p.now, p.tz)}, клуб «${p.clubName}» спишет ${formatMoney(p.amount, p.currency)}${p.lower ? ' (цена снизилась)' : ''} за абонемент «${p.planName}» ${card}. Отключить — в «Мой абонемент».`,
        })
    }

    async packLow(p: {
        autopayId: string
        anchorId: string
        userId: string
        workspaceId: string
        planName: string
        amount: number
        currency: string
    }) {
        await this.toMember({
            userId: p.userId,
            workspaceId: p.workspaceId,
            kind: AUTOPAY_KINDS.reminder,
            refId: `${p.autopayId}:${p.anchorId}:low`,
            autopayId: p.autopayId,
            email: false,
            topic: 'Осталось одно занятие',
            message: `Осталось одно занятие. Когда оно пройдёт, спишем ${formatMoney(p.amount, p.currency)} за новый абонемент «${p.planName}».`,
        })
    }

    async chargeFailed(p: {
        autopayId: string
        paymentId: string
        userId: string
        workspaceId: string
        planName: string
        amount: number
        currency: string
        reasonText: string
        // null: stopped (NEEDS_ACTION) or cancelled.
        nextAttemptAt: Date | null
        tz: string
    }) {
        const head = `Не удалось списать ${formatMoney(p.amount, p.currency)} за абонемент «${p.planName}»: ${p.reasonText}.`
        await this.toMember({
            userId: p.userId,
            workspaceId: p.workspaceId,
            kind: AUTOPAY_KINDS.failed,
            refId: p.paymentId,
            autopayId: p.autopayId,
            email: true,
            topic: p.nextAttemptAt ? 'Автоплатёж не прошёл' : 'Автоплатёж остановлен',
            message: p.nextAttemptAt
                ? `${head} Повторим ${formatRuDate(p.nextAttemptAt, p.tz)}.`
                : `${head} Автоплатёж остановлен. Оплатите абонемент в приложении — новая карта сохранится.`,
        })
    }

    async termsChanged(p: {
        autopayId: string
        refId: string
        userId: string
        workspaceId: string
        clubName: string
        planName: string
        before: { amount: number; currency: string; durationDays: number; classCount: number | null }
        after: { amount: number; currency: string; durationDays: number; classCount: number | null }
    }) {
        await this.toMember({
            userId: p.userId,
            workspaceId: p.workspaceId,
            kind: AUTOPAY_KINDS.termsChanged,
            refId: p.refId,
            autopayId: p.autopayId,
            email: true,
            topic: 'Клуб изменил тариф',
            message: `Клуб «${p.clubName}» изменил тариф «${p.planName}»: было ${autopayTermsText(p.before)}, стало ${autopayTermsText(p.after)}. Без вашего подтверждения деньги не спишутся. Подтвердить или отключить — в «Мой абонемент».`,
        })
    }

    async cancelled(p: {
        autopayId: string
        userId: string
        workspaceId: string
        planName: string
        // Shown unless the member cancelled it themselves.
        reason: string | null
        // The current abonement's end (null: none).
        accessUntil: Date | null
        tz: string
    }) {
        await this.toMember({
            userId: p.userId,
            workspaceId: p.workspaceId,
            kind: AUTOPAY_KINDS.cancelled,
            refId: p.autopayId,
            autopayId: p.autopayId,
            email: true,
            ungated: true,
            topic: 'Автоплатёж отключён',
            message: `Автоплатёж по тарифу «${p.planName}» отключён${p.reason ? ` — ${p.reason}` : ''}. Следующих списаний не будет.${
                p.accessUntil
                    ? ` Текущий абонемент действует до ${formatRuDate(p.accessUntil, p.tz)}.`
                    : ''
            }`,
        })
    }

    // Owner + club admins: the first decline, a stop, a charge not granted, a
    // setup YooKassa refused. Inbox + push, no e-mail; the link opens the admin.
    async staffAlert(p: {
        workspaceId: string
        refId: string
        message: string
        // Admin path under /workspace/:id (e.g. `retention?tab=renew`).
        path: string
        metadata?: Record<string, unknown>
    }) {
        try {
            const ws = await this.prisma.workspace.findUniqueOrThrow({
                where: { id: p.workspaceId },
                select: { ownerId: true },
            })
            const recipients = await findAutopayStaffRecipients(this.prisma, {
                workspaceId: p.workspaceId,
                ownerId: ws.ownerId,
            })
            const link = environment.adminUrl
                ? `${environment.adminUrl.replace(/\/+$/, '')}/workspace/${p.workspaceId}/${p.path}`
                : null
            for (const userId of recipients) {
                await this.producer.notifyUser({
                    userId,
                    kind: AUTOPAY_KINDS.staffAlert,
                    refId: `${p.refId}:${userId}`,
                    topic: 'Автоплатёж',
                    message: p.message,
                    link,
                    metadata: p.metadata,
                    workspaceId: p.workspaceId,
                })
            }
        } catch (err) {
            this.logger.warn(`Autopay staff alert ${p.refId} failed: ${errText(err)}`)
        }
    }

    private async toMember(n: MemberNotice) {
        try {
            const sent = await this.producer.notifyUser({
                userId: n.userId,
                kind: n.kind,
                refId: n.refId,
                topic: n.topic,
                message: n.message,
                metadata: { autopayId: n.autopayId },
                workspaceId: n.workspaceId,
                ...(n.ungated ? {} : { feature: 'subscription' as const }),
            })
            if (!sent || !n.email) return
            const user = await this.prisma.user.findUnique({
                where: { id: n.userId },
                select: { email: true },
            })
            if (!user?.email) return
            await this.notifications.sendNotification({
                userId: n.userId,
                type: 'EMAIL',
                identity: user.email,
                topic: n.topic,
                message: `<p>${escapeHtml(n.message)}</p>`,
                metadata: { kind: n.kind, workspaceId: n.workspaceId, autopayId: n.autopayId },
            })
        } catch (err) {
            this.logger.warn(`Autopay notice ${n.kind} ${n.refId} failed: ${errText(err)}`)
        }
    }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
