// The club's monthly allowance of questions to its AI model, shared by the
// admin's «ИИ-ассистент» chat and the members' «Спросить ИИ по видео клуба»:
// every AiChatUsage row of the calendar month (club time) counts, whatever its
// kind. The smaller allowance applies while the club is on its unpaid trial.
import { trialCapsApply } from '../billing/trial-limits'
import { environment } from '../../environments/environment'
import { localDateInTz, wallClockToUtc } from '../../features/attendance/attendance-utils'
import { monthBounds } from '../../features/ai-chat/ai-chat-utils'
import type { Prisma } from '../../infrastructure/prisma'

export type AiAllowance = { perMonth: number; used: number; remaining: number }

// The client or a transaction: the members' answers count under the club's
// advisory lock together with the insert (ask-club-videos.handler.ts).
type AllowanceDb = Pick<Prisma.TransactionClient, 'aiChatUsage' | 'workspaceBilling'>

export const monthlyAiAllowance = async (
    prisma: AllowanceDb,
    club: { workspaceId: string; timezone: string },
    now: Date,
): Promise<AiAllowance> => {
    const { from, to } = monthBounds(localDateInTz(now, club.timezone))
    const [used, billing] = await Promise.all([
        prisma.aiChatUsage.count({
            where: {
                workspaceId: club.workspaceId,
                createdAt: {
                    gte: wallClockToUtc(`${from}T00:00:00`, club.timezone),
                    lt: wallClockToUtc(`${to}T00:00:00`, club.timezone),
                },
            },
        }),
        prisma.workspaceBilling.findUnique({
            where: { workspaceId: club.workspaceId },
            select: { status: true, currentPeriodEnd: true },
        }),
    ])
    const { monthlyQuestions, trialMonthlyQuestions } = environment.ai.chat
    const perMonth = trialCapsApply(billing, now, environment.billing.enabled)
        ? trialMonthlyQuestions
        : monthlyQuestions
    return { perMonth, used, remaining: Math.max(0, perMonth - used) }
}
