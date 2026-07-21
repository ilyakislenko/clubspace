import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    BulkUpdateVideosFeature,
    BulkUpdateVideosFeatureResponse,
    BulkUpdateVideosInputSchema,
    BulkUpdateVideosOutputSchema,
} from './bulk-update-videos.feature'

class BulkUpdateVideosInput extends createZodDto(
    BulkUpdateVideosInputSchema,
) {}
class BulkUpdateVideosOutput extends createZodDto(
    BulkUpdateVideosOutputSchema,
) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class BulkUpdateVideosController {
    constructor(private bus: FeaturesBus) {}

    @Post('bulk')
    @ZodResponse({ type: BulkUpdateVideosOutput })
    async bulkUpdate(
        @Body() input: BulkUpdateVideosInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            BulkUpdateVideosFeature,
            BulkUpdateVideosFeatureResponse
        >(new BulkUpdateVideosFeature(input, user.userId))
    }
}
