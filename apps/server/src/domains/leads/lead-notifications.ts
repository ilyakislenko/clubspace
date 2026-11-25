// Who hears about leads and what they read (docs/design/2026-11-26-leads.md
// §3.4). No personal data of a lead in any text (see leadCreatedText).

import type { PrismaService } from '../../infrastructure/prisma'
import { SPORT_LEADS } from '../../shared/decorators/roles.decorator'
import type { NotificationProducerService } from '../notifications/services/notification-producer.service'

// The owner plus ACTIVE members whose role is in SPORT_LEADS.
export const loadLeadRecipients = async (
    prisma: Pick<PrismaService, 'workspaceMember'>,
    p: { workspaceId: string; ownerId: string },
): Promise<string[]> => {
    const staff = await prisma.workspaceMember.findMany({
        where: {
            workspaceId: p.workspaceId,
            status: 'ACTIVE',
            role: { name: { in: SPORT_LEADS } },
        },
        select: { userId: true },
    })
    return [...new Set([p.ownerId, ...staff.map((s) => s.userId)])]
}

// The row's topic and message are the push's title and body, and a push
// crosses the border (Expo, web push services), so no lead's personal data —
// not even a first name or a child's age — goes into any of these texts. The
// club's own direction name is not personal data.
export const leadCreatedText = (lead: { directionName: string | null }) => ({
    topic: 'Новая заявка на пробное',
    message: `${
        lead.directionName ? `${lead.directionName}. ` : ''
    }Откройте «Ученики → Пробные».`,
})

export const leadStaleText = (count: number) => ({
    topic: 'Заявки ждут звонка',
    message: `Заявки на пробное ждут ответа больше суток: ${count}`,
})

// «пт, 21 нояб., 18:00» in the trial's zone.
export const formatTrialWhen = (at: Date, timeZone: string): string => {
    const day = new Intl.DateTimeFormat('ru-RU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
    }).format(at)
    const time = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    }).format(at)
    return `${day}, ${time}`
}

// The coach learns when and where, not who: the group's roster shows the
// person once they come.
export const leadTrialBookedText = (p: {
    trialAt: Date
    timeZone: string
    groupName: string
}) => ({
    topic: 'На пробное придёт новый человек',
    message: `${formatTrialWhen(p.trialAt, p.timeZone)} · «${p.groupName}»`,
})

// One inbox entry + push per sport lead about a new lead (never to the staff
// member who entered it). Deduped per lead and recipient. Failures are the
// caller's to log: the lead is already saved.
export const notifyLeadCreated = async (
    deps: {
        prisma: Pick<PrismaService, 'workspaceMember'>
        notifications: Pick<NotificationProducerService, 'notifyUser'>
    },
    p: {
        workspaceId: string
        ownerId: string
        exceptUserId: string | null
        lead: { id: string; directionName: string | null }
    },
): Promise<number> => {
    const recipients = (
        await loadLeadRecipients(deps.prisma, p)
    ).filter((id) => id !== p.exceptUserId)
    const text = leadCreatedText(p.lead)
    let sent = 0
    for (const userId of recipients) {
        const ok = await deps.notifications.notifyUser({
            userId,
            kind: 'lead.created',
            refId: `${p.lead.id}:${userId}`,
            ...text,
            link: null,
            workspaceId: p.workspaceId,
            metadata: { workspaceId: p.workspaceId, leadId: p.lead.id },
        })
        if (ok) sent += 1
    }
    return sent
}
