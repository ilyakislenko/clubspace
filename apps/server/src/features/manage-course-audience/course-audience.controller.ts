import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
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
    GetCourseAudienceFeature,
    GetCourseAudienceFeatureOutputSchema,
    type GetCourseAudienceFeatureResponse,
} from './get-course-audience.feature'
import {
    UpdateCourseAudienceFeature,
    UpdateCourseAudienceFeatureInputSchema,
    UpdateCourseAudienceFeatureOutputSchema,
    type UpdateCourseAudienceFeatureResponse,
} from './update-course-audience.feature'

class CourseAudienceOutput extends createZodDto(
    GetCourseAudienceFeatureOutputSchema,
) {}
class UpdateCourseAudienceInput extends createZodDto(
    UpdateCourseAudienceFeatureInputSchema,
) {}
class UpdateCourseAudienceOutput extends createZodDto(
    UpdateCourseAudienceFeatureOutputSchema,
) {}

// Who may watch a course (groups / minimum rank / plans). Same tier as the
// rest of the course editor: coaching staff, checked again in the handlers.
@Controller('workspaces/:workspaceId/playlists/:playlistId/audience')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CourseAudienceController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: CourseAudienceOutput })
    async getCourseAudience(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetCourseAudienceFeature,
            GetCourseAudienceFeatureResponse
        >(
            new GetCourseAudienceFeature(
                workspaceId,
                playlistId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put()
    @ZodResponse({ type: UpdateCourseAudienceOutput })
    async updateCourseAudience(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() body: UpdateCourseAudienceInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateCourseAudienceFeature,
            UpdateCourseAudienceFeatureResponse
        >(
            new UpdateCourseAudienceFeature(
                body,
                workspaceId,
                playlistId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
