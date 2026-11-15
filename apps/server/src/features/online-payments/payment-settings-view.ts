import type { PrismaService } from '../../infrastructure/prisma'
import { serializePaymentSettings } from './schemas'

// The admin's view of the club's payment settings: the saved row (secrets
// masked), how many tariffs are sold online and how many members are on
// autopay. Shared by every settings endpoint, so they all answer with the
// same shape.
export const loadPaymentSettingsView = async (
    prisma: PrismaService,
    workspaceId: string,
) => {
    const [row, onlinePlanCount, autopayLiveCount] = await Promise.all([
        prisma.workspacePaymentSettings.findUnique({ where: { workspaceId } }),
        prisma.plan.count({
            where: { workspaceId, isActive: true, purchasableOnline: true },
        }),
        prisma.memberAutopay.count({
            where: { workspaceId, status: { in: ['ACTIVE', 'NEEDS_ACTION'] } },
        }),
    ])
    return serializePaymentSettings(workspaceId, row, onlinePlanCount, autopayLiveCount)
}
