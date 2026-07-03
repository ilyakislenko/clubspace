import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
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
    CreateAttendanceSessionFeature,
    CreateAttendanceSessionInputSchema,
    CreateAttendanceSessionOutputSchema,
    type CreateAttendanceSessionFeatureResponse,
} from './create-session.feature'
import {
    DeleteSessionFeature,
    DeleteSessionOutputSchema,
    type DeleteSessionFeatureResponse,
} from './delete-session.feature'
import {
    GetAttendanceOverviewFeature,
    GetAttendanceOverviewInputSchema,
    GetAttendanceOverviewOutputSchema,
    type GetAttendanceOverviewFeatureResponse,
} from './get-overview.feature'
import {
    GetMyAttendanceFeature,
    GetMyAttendanceInputSchema,
    GetMyAttendanceOutputSchema,
    type GetMyAttendanceFeatureResponse,
} from './get-my-attendance.feature'
import {
    GetSessionRosterFeature,
    type GetSessionRosterFeatureResponse,
} from './get-roster.feature'
import {
    ListSessionsFeature,
    ListSessionsInputSchema,
    ListSessionsOutputSchema,
    type ListSessionsFeatureResponse,
} from './list-sessions.feature'
import {
    MarkRecordsFeature,
    MarkRecordsInputSchema,
    type MarkRecordsFeatureResponse,
} from './mark-records.feature'
import { SessionRosterOutputSchema } from './schemas'
import {
    UnmarkRecordFeature,
    type UnmarkRecordFeatureResponse,
} from './unmark-record.feature'

class CreateAttendanceSessionInput extends createZodDto(
    CreateAttendanceSessionInputSchema,
) {}
class AttendanceSessionOutputDto extends createZodDto(
    CreateAttendanceSessionOutputSchema,
) {}
class MarkRecordsInputDto extends createZodDto(MarkRecordsInputSchema) {}
class SessionRosterOutputDto extends createZodDto(SessionRosterOutputSchema) {}
class ListSessionsQuery extends createZodDto(ListSessionsInputSchema) {}
class ListSessionsOutput extends createZodDto(ListSessionsOutputSchema) {}
class DeleteSessionOutput extends createZodDto(DeleteSessionOutputSchema) {}
class MyAttendanceQuery extends createZodDto(GetMyAttendanceInputSchema) {}
class MyAttendanceOutput extends createZodDto(GetMyAttendanceOutputSchema) {}
class AttendanceOverviewQuery extends createZodDto(
    GetAttendanceOverviewInputSchema,
) {}
class AttendanceOverviewOutput extends createZodDto(
    GetAttendanceOverviewOutputSchema,
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

    @Get('sessions')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListSessionsOutput })
    async listSessions(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListSessionsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListSessionsFeature,
            ListSessionsFeatureResponse
        >(
            new ListSessionsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('sessions/:sessionId/roster')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: SessionRosterOutputDto })
    async getSessionRoster(
        @Param('workspaceId') workspaceId: string,
        @Param('sessionId') sessionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetSessionRosterFeature,
            GetSessionRosterFeatureResponse
        >(
            new GetSessionRosterFeature(
                workspaceId,
                sessionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('sessions/:sessionId/records')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: SessionRosterOutputDto })
    async markRecords(
        @Param('workspaceId') workspaceId: string,
        @Param('sessionId') sessionId: string,
        @Body() body: MarkRecordsInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            MarkRecordsFeature,
            MarkRecordsFeatureResponse
        >(
            new MarkRecordsFeature(
                body,
                workspaceId,
                sessionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('sessions/:sessionId/records/:userId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: SessionRosterOutputDto })
    async unmarkRecord(
        @Param('workspaceId') workspaceId: string,
        @Param('sessionId') sessionId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UnmarkRecordFeature,
            UnmarkRecordFeatureResponse
        >(
            new UnmarkRecordFeature(
                workspaceId,
                sessionId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    // Any workspace member can read their own attendance — no @Roles.
    @Get('me')
    @ZodResponse({ type: MyAttendanceOutput })
    async getMyAttendance(
        @Param('workspaceId') workspaceId: string,
        @Query() query: MyAttendanceQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyAttendanceFeature,
            GetMyAttendanceFeatureResponse
        >(new GetMyAttendanceFeature(query, workspaceId, user.userId))
    }

    @Get('overview')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AttendanceOverviewOutput })
    async getAttendanceOverview(
        @Param('workspaceId') workspaceId: string,
        @Query() query: AttendanceOverviewQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetAttendanceOverviewFeature,
            GetAttendanceOverviewFeatureResponse
        >(
            new GetAttendanceOverviewFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('sessions/:sessionId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeleteSessionOutput })
    async deleteSession(
        @Param('workspaceId') workspaceId: string,
        @Param('sessionId') sessionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteSessionFeature,
            DeleteSessionFeatureResponse
        >(
            new DeleteSessionFeature(
                workspaceId,
                sessionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
