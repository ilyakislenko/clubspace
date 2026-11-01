import type { ModuleMode } from '../../domains/billing/module-entitlement'
import type { PlatformModuleCode } from '../../domains/billing/platform-pricing.config'
import type { PrismaService } from '../../infrastructure/prisma'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// Sets a club's module entitlement row (the console's module switch and the
// «видео в подарок» promo). Update first, create when there is none; a
// second operator creating it meanwhile → last write wins.
export const writeModuleEntitlement = async (
    prisma: PrismaService,
    where: { workspaceId: string; module: PlatformModuleCode },
    data: {
        mode: ModuleMode
        compUntil: Date | null
        customPrice: number | null
        cancelAt: Date | null
    },
): Promise<void> => {
    const { count } = await prisma.workspaceModuleEntitlement.updateMany({
        where,
        data,
    })
    if (count > 0) return
    try {
        await prisma.workspaceModuleEntitlement.create({
            data: { ...where, ...data },
        })
    } catch (e) {
        if (!isP2002(e)) throw e
        await prisma.workspaceModuleEntitlement.updateMany({ where, data })
    }
}
