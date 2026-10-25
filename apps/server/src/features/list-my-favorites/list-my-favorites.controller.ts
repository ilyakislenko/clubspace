import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { RequiresFeature } from '../../shared/decorators/requires-feature.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { FeatureEnabledGuard } from '../../shared/guards/feature-enabled.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListMyFavoritesFeature,
    ListMyFavoritesFeatureOutputSchema,
    ListMyFavoritesFeatureResponse,
} from './list-my-favorites.feature'

class ListMyFavoritesOutput extends createZodDto(
    ListMyFavoritesFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/me/favorites')
@UseGuards(AuthGuard, WorkspaceMemberGuard, FeatureEnabledGuard)
@RequiresFeature('videos')
export class ListMyFavoritesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyFavoritesOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListMyFavoritesFeature,
            ListMyFavoritesFeatureResponse
        >(new ListMyFavoritesFeature(user.userId, workspaceId))
    }
}
