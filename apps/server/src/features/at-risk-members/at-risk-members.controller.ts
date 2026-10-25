import {
    Body,
    Controller,
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
import {
    COACHING_ROLES,
    Roles,
    STAFF_ROLES,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListAtRiskMembersFeature,
    ListAtRiskMembersFeatureResponse,
    ListAtRiskMembersInputSchema,
    ListAtRiskMembersOutputSchema,
} from './list-at-risk-members.feature'
import {
    LogAtRiskContactFeature,
    LogAtRiskContactFeatureResponse,
    LogAtRiskContactInputSchema,
    LogAtRiskContactOutputSchema,
} from './log-at-risk-contact.feature'

class ListAtRiskMembersQuery extends createZodDto(
    ListAtRiskMembersInputSchema,
) {}
class ListAtRiskMembersOutput extends createZodDto(
    ListAtRiskMembersOutputSchema,
) {}
class LogAtRiskContactInput extends createZodDto(
    LogAtRiskContactInputSchema,
) {}
class LogAtRiskContactOutput extends createZodDto(
    LogAtRiskContactOutputSchema,
) {}

@Controller('workspaces/:workspaceId/at-risk-members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AtRiskMembersController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListAtRiskMembersOutput })
    async listAtRiskMembers(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListAtRiskMembersQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListAtRiskMembersFeature,
            ListAtRiskMembersFeatureResponse
        >(
            new ListAtRiskMembersFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':userId/contacts')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: LogAtRiskContactOutput })
    async logAtRiskContact(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: LogAtRiskContactInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            LogAtRiskContactFeature,
            LogAtRiskContactFeatureResponse
        >(
            new LogAtRiskContactFeature(
                body,
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
