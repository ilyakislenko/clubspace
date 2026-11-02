import {
    isWorkspaceEntitled,
    moduleEntitlementSelect,
} from '../../domains/billing/module-entitlement'
import { onlineGrantAbonementSelect } from '../../domains/payments/online-grant-start'
import { currentSubscriptionWhere } from '../../domains/subscriptions/current-subscriptions'
import type { PrismaService } from '../../infrastructure/prisma'
import {
    ForbiddenError,
    ModuleNotEntitledError,
    NotFoundError,
} from '../../shared/errors/shared.errors'

// What every member-side payment endpoint needs: the club (feature switch,
// owner, timezone) and the caller's membership with their current abonements.
// `member` is null for the owner and for anyone without a member row.
export const loadBuyer = async (
    prisma: PrismaService,
    p: { workspaceId: string; userId: string },
) => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: {
            name: true,
            ownerId: true,
            timezone: true,
            type: true,
            subscriptionEnabled: true,
            ...moduleEntitlementSelect('ONLINE_PAYMENTS'),
        },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
    const member =
        p.userId === workspace.ownerId
            ? null
            : await prisma.workspaceMember.findFirst({
                  where: { workspaceId: p.workspaceId, userId: p.userId },
                  select: {
                      id: true,
                      subscriptions: {
                          where: currentSubscriptionWhere(),
                          select: onlineGrantAbonementSelect,
                      },
                  },
              })
    return { workspace, member }
}

export const sectionDisabledError = () =>
    new ForbiddenError({ message: 'Этот раздел отключён в вашем клубе' })

// The club's ONLINE_PAYMENTS module is not entitled: members pay in the club.
export const onlinePaymentsUnavailableError = () =>
    new ModuleNotEntitledError({
        module: 'ONLINE_PAYMENTS',
        message:
            'Онлайн-оплата в этом клубе сейчас недоступна. Оплатите абонемент в клубе.',
    })

// Tariffs a member may buy online: flagged by the club, live, not free.
export const purchasablePlanWhere = (workspaceId: string) => ({
    workspaceId,
    isActive: true,
    purchasableOnline: true,
    isFreeTrial: false,
    price: { gt: 0 },
})

// The club takes payments online at all: a provider is connected and the
// ONLINE_PAYMENTS module is on. (Tariffs also need the abonement section and
// a tariff sold online — see get-online-purchase-options.)
export const clubTakesOnlinePayments = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<boolean> => {
    const [workspace, settings] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: moduleEntitlementSelect('ONLINE_PAYMENTS'),
        }),
        prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId },
            select: { workspaceId: true },
        }),
    ])
    return !!workspace && !!settings && isWorkspaceEntitled(workspace)
}

// A pending payment is shown (and reused for a repeated tap) for this long;
// the provider's page expires on its own after that.
export const PENDING_VISIBLE_MS = 24 * 60 * 60 * 1000
export const PENDING_REUSE_MS = 30 * 60 * 1000
