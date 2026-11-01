import {
    Body,
    Controller,
    Headers,
    Ip,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowSuspendedWorkspace } from '../../shared/decorators/allow-suspended-workspace.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptWorkspaceLegalFeature,
    AcceptWorkspaceLegalFeatureResponse,
    AcceptWorkspaceLegalInputSchema,
    AcceptWorkspaceLegalOutputSchema,
} from './accept-workspace-legal.feature'

class AcceptWorkspaceLegalInputDto extends createZodDto(
    AcceptWorkspaceLegalInputSchema,
) {}
class AcceptWorkspaceLegalOutput extends createZodDto(
    AcceptWorkspaceLegalOutputSchema,
) {}

// The club owner accepts the platform's offer + DPA editions. Open in a
// suspended club: accepting is what unlocks paying for it.
@Controller('workspaces/:workspaceId/billing/legal')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceLegalController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: AcceptWorkspaceLegalOutput })
    async acceptWorkspaceLegal(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AcceptWorkspaceLegalInputDto,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return await this.bus.execute<
            AcceptWorkspaceLegalFeature,
            AcceptWorkspaceLegalFeatureResponse
        >(
            new AcceptWorkspaceLegalFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }
}
