import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common'
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
    CreateAchievementFeature,
    CreateAchievementInputSchema,
    CreateAchievementOutputSchema,
    type CreateAchievementFeatureResponse,
} from './create-achievement.feature'
import {
    DeleteAchievementFeature,
    DeleteAchievementOutputSchema,
    type DeleteAchievementFeatureResponse,
} from './delete-achievement.feature'
import {
    ListAchievementsFeature,
    ListAchievementsOutputSchema,
    type ListAchievementsFeatureResponse,
} from './list-achievements.feature'
import {
    ReorderAchievementsFeature,
    ReorderAchievementsInputSchema,
    type ReorderAchievementsFeatureResponse,
} from './reorder-achievements.feature'
import {
    SeedDefaultAchievementsFeature,
    type SeedDefaultAchievementsFeatureResponse,
} from './seed-default-achievements.feature'
import {
    UpdateAchievementFeature,
    UpdateAchievementInputSchema,
    type UpdateAchievementFeatureResponse,
} from './update-achievement.feature'

class CreateAchievementInput extends createZodDto(
    CreateAchievementInputSchema,
) {}
class ReorderAchievementsInput extends createZodDto(
    ReorderAchievementsInputSchema,
) {}
class UpdateAchievementInput extends createZodDto(
    UpdateAchievementInputSchema,
) {}
class AchievementOutputDto extends createZodDto(CreateAchievementOutputSchema) {}
class ListAchievementsOutput extends createZodDto(ListAchievementsOutputSchema) {}
class DeleteAchievementOutput extends createZodDto(
    DeleteAchievementOutputSchema,
) {}

@Controller('workspaces/:workspaceId/achievements')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AchievementsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAchievementsOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListAchievementsFeature,
            ListAchievementsFeatureResponse
        >(
            new ListAchievementsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('seed-defaults')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAchievementsOutput })
    async seedDefaults(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SeedDefaultAchievementsFeature,
            SeedDefaultAchievementsFeatureResponse
        >(
            new SeedDefaultAchievementsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('reorder')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAchievementsOutput })
    async reorder(
        @Param('workspaceId') workspaceId: string,
        @Body() body: ReorderAchievementsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ReorderAchievementsFeature,
            ReorderAchievementsFeatureResponse
        >(
            new ReorderAchievementsFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AchievementOutputDto })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateAchievementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateAchievementFeature,
            CreateAchievementFeatureResponse
        >(
            new CreateAchievementFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':achievementId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AchievementOutputDto })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('achievementId') achievementId: string,
        @Body() body: UpdateAchievementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateAchievementFeature,
            UpdateAchievementFeatureResponse
        >(
            new UpdateAchievementFeature(
                body,
                workspaceId,
                achievementId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':achievementId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeleteAchievementOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('achievementId') achievementId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteAchievementFeature,
            DeleteAchievementFeatureResponse
        >(
            new DeleteAchievementFeature(
                workspaceId,
                achievementId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
