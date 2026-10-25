import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowExpiredAccess } from '../../shared/decorators/allow-expired-access.decorator'
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
    GetClubAboutFeature,
    GetClubAboutFeatureOutputSchema,
    type GetClubAboutFeatureResponse,
} from './get-club-about.feature'
import {
    UpdateClubAboutFeature,
    UpdateClubAboutFeatureInputSchema,
    UpdateClubAboutFeatureOutputSchema,
    type UpdateClubAboutFeatureResponse,
} from './update-club-about.feature'

class ClubAboutOutputDto extends createZodDto(
    GetClubAboutFeatureOutputSchema,
) {}
class UpdateClubAboutInput extends createZodDto(
    UpdateClubAboutFeatureInputSchema,
) {}
class UpdateClubAboutOutputDto extends createZodDto(
    UpdateClubAboutFeatureOutputSchema,
) {}

// Reads (GET) are open to any workspace member — contacts and rules are for
// students — including one whose access has expired: the lock screen shows the
// club's contacts. The write is workspace-admin only.
@Controller('workspaces/:workspaceId/about')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubAboutController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @AllowExpiredAccess()
    @ZodResponse({ type: ClubAboutOutputDto })
    async getClubAbout(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<
            GetClubAboutFeature,
            GetClubAboutFeatureResponse
        >(new GetClubAboutFeature(workspaceId))
    }

    @Put()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateClubAboutOutputDto })
    async updateClubAbout(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdateClubAboutInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateClubAboutFeature,
            UpdateClubAboutFeatureResponse
        >(
            new UpdateClubAboutFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
