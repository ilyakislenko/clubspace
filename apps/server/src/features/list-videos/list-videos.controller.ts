import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListVideosFeature,
    ListVideosFeatureInputSchema,
    ListVideosFeatureOutputSchema,
    ListVideosFeatureResponse,
} from './list-videos.feature'

class ListVideosQuery extends createZodDto(ListVideosFeatureInputSchema) {}

class ListVideosOutput extends createZodDto(ListVideosFeatureOutputSchema) {}

// Admin content-management listing — coaching staff only, not every member.
@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class ListVideosController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListVideosOutput })
    async listVideos(@Query() query: ListVideosQuery) {
        return await this.bus.execute<ListVideosFeature, ListVideosFeatureResponse>(
            new ListVideosFeature(query),
        )
    }
}
