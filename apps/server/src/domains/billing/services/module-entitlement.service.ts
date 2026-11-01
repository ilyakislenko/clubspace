import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { ModuleNotEntitledError } from '../../../shared/errors/shared.errors'
import {
    isWorkspaceEntitled,
    MODULE_NOT_ENTITLED_MESSAGE,
    moduleEntitlementSelect,
} from '../module-entitlement'
import type { PlatformModuleCode } from '../platform-pricing.config'

// The server-side gate of the paid modules: one indexed read of the club's
// billing status and its row for the module.
@Injectable()
export class ModuleEntitlementService {
    constructor(private readonly prisma: PrismaService) {}

    async isEntitled(
        workspaceId: string,
        module: PlatformModuleCode,
    ): Promise<boolean> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: moduleEntitlementSelect(module),
        })
        return workspace ? isWorkspaceEntitled(workspace) : false
    }

    // Throws MODULE_NOT_ENTITLED (403) with the module's Russian explanation,
    // or `message` when the caller is someone other than the club's staff.
    async assertEntitled(
        workspaceId: string,
        module: PlatformModuleCode,
        message?: string,
    ): Promise<void> {
        if (await this.isEntitled(workspaceId, module)) return
        throw new ModuleNotEntitledError({
            module,
            message: message ?? MODULE_NOT_ENTITLED_MESSAGE[module],
        })
    }
}
