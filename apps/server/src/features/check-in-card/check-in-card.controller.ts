import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    COACHING_ROLES,
    Roles,
    SPORT_LEADS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMemberCheckInCardFeature,
    GetMemberCheckInCardOutputSchema,
    type GetMemberCheckInCardFeatureResponse,
} from './get-member-check-in-card.feature'
import {
    GetMyCheckInCardFeature,
    GetMyCheckInCardOutputSchema,
    type GetMyCheckInCardFeatureResponse,
} from './get-my-check-in-card.feature'
import {
    LookupCheckInCardFeature,
    LookupCheckInCardInputSchema,
    LookupCheckInCardOutputSchema,
    type LookupCheckInCardFeatureResponse,
} from './lookup-check-in-card.feature'

class MyCheckInCardOutput extends createZodDto(GetMyCheckInCardOutputSchema) {}
class MemberCheckInCardOutput extends createZodDto(
    GetMemberCheckInCardOutputSchema,
) {}
class LookupCheckInCardInput extends createZodDto(
    LookupCheckInCardInputSchema,
) {}
class LookupCheckInCardOutput extends createZodDto(
    LookupCheckInCardOutputSchema,
) {}

// «Моя карта» and the coach's door scan (docs/design/2026-11-26-door-checkin-and-birthdays.md §3.1).
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class CheckInCardController {
    constructor(private bus: FeaturesBus) {}

    // Any member (no @Roles); a guardian acting for a child gets the child's.
    // No @AllowExpiredAccess: a member whose access ran out can't train — the
    // coach can still mark them from the roster.
    @Get('me/check-in-card')
    @ZodResponse({ type: MyCheckInCardOutput })
    async getMyCheckInCard(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyCheckInCardFeature,
            GetMyCheckInCardFeatureResponse
        >(new GetMyCheckInCardFeature(workspaceId, user.userId))
    }

    @Get('members/:userId/check-in-card')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: MemberCheckInCardOutput })
    async getMemberCheckInCard(
        @Param('workspaceId') workspaceId: string,
        @Param('userId', ParseUUIDPipe) userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMemberCheckInCardFeature,
            GetMemberCheckInCardFeatureResponse
        >(
            new GetMemberCheckInCardFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    // A door of 30 people in a few minutes, plus retries of a queued batch.
    // Reads only: 200, not 201.
    @Post('attendance/sessions/:sessionId/card-lookup')
    @Roles(COACHING_ROLES)
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { ttl: 60_000, limit: 120 } })
    @ZodResponse({ type: LookupCheckInCardOutput })
    async lookupCheckInCard(
        @Param('workspaceId') workspaceId: string,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Body() body: LookupCheckInCardInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            LookupCheckInCardFeature,
            LookupCheckInCardFeatureResponse
        >(
            new LookupCheckInCardFeature(
                body,
                workspaceId,
                sessionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
