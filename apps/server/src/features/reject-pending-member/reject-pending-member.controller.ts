import {
    Body,
    Controller,
    DefaultValuePipe,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { ApiBody } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    SPORT_LEADS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    RejectPendingMemberFeature,
    RejectPendingMemberFeatureOutputSchema,
    RejectPendingMemberFeatureResponse,
    type RejectPendingMemberInputPayload,
    RejectPendingMemberInputSchema,
} from './reject-pending-member.feature'

class RejectPendingMemberInput extends createZodDto(RejectPendingMemberInputSchema) {}
class RejectPendingMemberOutput extends createZodDto(
    RejectPendingMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RejectPendingMemberController {
    constructor(private bus: FeaturesBus) {}

    @Post(':userId/reject')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: RejectPendingMemberOutput })
    @ApiBody({ type: RejectPendingMemberInput, required: false })
    async rejectPendingMember(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        // The app rejects without a body, which Express leaves undefined: the
        // param type is not the DTO class, so the global pipe passes it on
        // and these pipes default it to {} before validating.
        @Body(new DefaultValuePipe({}), new ZodValidationPipe(RejectPendingMemberInput))
        body: RejectPendingMemberInputPayload,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RejectPendingMemberFeature,
            RejectPendingMemberFeatureResponse
        >(
            new RejectPendingMemberFeature(
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
