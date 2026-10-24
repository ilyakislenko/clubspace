import { subscriptionUsabilitySelect } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { DropInBlockReason, dropInBlockReason } from './drop-in-utils'

// Shared by booking and the "my bookings" read, so the screen's canBook and the
// POST's refusal always agree.
export const loadDropInEligibility = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    now: Date,
): Promise<{
    timezone: string
    reason: DropInBlockReason | null
    subscription: {
        id: string
        classesRemaining: number | null
        status: string
        endDate: Date | null
    } | null
}> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            timezone: true,
            guestVisitsEnabled: true,
            scheduleEnabled: true,
            subscriptionEnabled: true,
        },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })

    // The owner has no member row: member stays null and reads as not_member.
    const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        select: {
            status: true,
            subscription: {
                select: {
                    id: true,
                    classesRemaining: true,
                    ...subscriptionUsabilitySelect,
                },
            },
        },
    })

    return {
        timezone: workspace.timezone,
        reason: dropInBlockReason({
            featureOn: workspace.guestVisitsEnabled && workspace.scheduleEnabled,
            member,
            subscriptionRequired: workspace.subscriptionEnabled,
            subscription: member?.subscription ?? null,
            now,
        }),
        subscription: member?.subscription ?? null,
    }
}
