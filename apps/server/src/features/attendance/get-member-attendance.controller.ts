import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMemberAttendanceFeature,
    GetMemberAttendanceFeatureResponse,
    GetMemberAttendanceInputSchema,
    GetMemberAttendanceOutputSchema,
} from './get-member-attendance.feature'

class GetMemberAttendanceQuery extends createZodDto(
    GetMemberAttendanceInputSchema,
) {}
class GetMemberAttendanceOutput extends createZodDto(
    GetMemberAttendanceOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMemberAttendanceController {
    constructor(private bus: FeaturesBus) {}

    @Get('attendance')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetMemberAttendanceOutput })
    async getMemberAttendance(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Query() query: GetMemberAttendanceQuery,
    ) {
        return await this.bus.execute<
            GetMemberAttendanceFeature,
            GetMemberAttendanceFeatureResponse
        >(new GetMemberAttendanceFeature(query, workspaceId, userId))
    }
}
