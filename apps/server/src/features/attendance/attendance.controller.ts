import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
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
    CreateAttendanceSessionFeature,
    CreateAttendanceSessionInputSchema,
    CreateAttendanceSessionOutputSchema,
    type CreateAttendanceSessionFeatureResponse,
} from './create-session.feature'

class CreateAttendanceSessionInput extends createZodDto(
    CreateAttendanceSessionInputSchema,
) {}
class AttendanceSessionOutputDto extends createZodDto(
    CreateAttendanceSessionOutputSchema,
) {}

@Controller('workspaces/:workspaceId/attendance')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AttendanceController {
    constructor(private bus: FeaturesBus) {}

    @Post('sessions')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AttendanceSessionOutputDto })
    async createSession(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateAttendanceSessionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateAttendanceSessionFeature,
            CreateAttendanceSessionFeatureResponse
        >(
            new CreateAttendanceSessionFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
