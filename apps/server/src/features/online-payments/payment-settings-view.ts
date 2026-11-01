import type { PrismaService } from '../../infrastructure/prisma'
import { serializePaymentSettings } from './schemas'

// The admin's view of the club's payment settings: the saved row (secrets
// masked) and how many tariffs are sold online. Shared by every settings
// endpoint, so they all answer with the same shape.
export const loadPaymentSettingsView = async (
    prisma: PrismaService,
    workspaceId: string,
) => {
    const [row, onlinePlanCount] = await Promise.all([
        prisma.workspacePaymentSettings.findUnique({ where: { workspaceId } }),
        prisma.plan.count({
            where: { workspaceId, isActive: true, purchasableOnline: true },
        }),
    ])
    return serializePaymentSettings(workspaceId, row, onlinePlanCount)
}
