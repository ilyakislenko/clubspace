import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
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
    CreateClassSubstitutionFeature,
    CreateClassSubstitutionInputSchema,
    CreateClassSubstitutionOutputSchema,
    type CreateClassSubstitutionFeatureResponse,
} from './create-class-substitution.feature'
import {
    ApproveClassSubstitutionFeature,
    CancelClassSubstitutionFeature,
    DeclineClassSubstitutionFeature,
    DecideClassSubstitutionOutputSchema,
    type DecideClassSubstitutionFeatureResponse,
} from './decide-class-substitution.feature'
import {
    ListClassSubstitutionsFeature,
    ListClassSubstitutionsInputSchema,
    ListClassSubstitutionsOutputSchema,
    ListSubstituteCandidatesFeature,
    ListSubstituteCandidatesOutputSchema,
    type ListClassSubstitutionsFeatureResponse,
    type ListSubstituteCandidatesFeatureResponse,
} from './list-class-substitutions.feature'

class CreateClassSubstitutionInputDto extends createZodDto(
    CreateClassSubstitutionInputSchema,
) {}
class ClassSubstitutionOutputDto extends createZodDto(
    CreateClassSubstitutionOutputSchema,
) {}
class DecideClassSubstitutionOutputDto extends createZodDto(
    DecideClassSubstitutionOutputSchema,
) {}
class ListClassSubstitutionsQueryDto extends createZodDto(
    ListClassSubstitutionsInputSchema,
) {}
class ListClassSubstitutionsOutputDto extends createZodDto(
    ListClassSubstitutionsOutputSchema,
) {}
class ListSubstituteCandidatesOutputDto extends createZodDto(
    ListSubstituteCandidatesOutputSchema,
) {}

// Замены: another coach runs one class (slot + day) of a group.
@Controller('workspaces/:workspaceId/class-substitutions')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClassSubstitutionsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListClassSubstitutionsOutputDto })
    async listClassSubstitutions(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListClassSubstitutionsQueryDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListClassSubstitutionsFeature,
            ListClassSubstitutionsFeatureResponse
        >(
            new ListClassSubstitutionsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('candidates')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListSubstituteCandidatesOutputDto })
    async listSubstituteCandidates(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListSubstituteCandidatesFeature,
            ListSubstituteCandidatesFeatureResponse
        >(
            new ListSubstituteCandidatesFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ClassSubstitutionOutputDto })
    async createClassSubstitution(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateClassSubstitutionInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateClassSubstitutionFeature,
            CreateClassSubstitutionFeatureResponse
        >(
            new CreateClassSubstitutionFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':substitutionId/approve')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DecideClassSubstitutionOutputDto })
    async approveClassSubstitution(
        @Param('workspaceId') workspaceId: string,
        @Param('substitutionId', ParseUUIDPipe) substitutionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ApproveClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >(
            new ApproveClassSubstitutionFeature(
                workspaceId,
                substitutionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':substitutionId/decline')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DecideClassSubstitutionOutputDto })
    async declineClassSubstitution(
        @Param('workspaceId') workspaceId: string,
        @Param('substitutionId', ParseUUIDPipe) substitutionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeclineClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >(
            new DeclineClassSubstitutionFeature(
                workspaceId,
                substitutionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':substitutionId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DecideClassSubstitutionOutputDto })
    async cancelClassSubstitution(
        @Param('workspaceId') workspaceId: string,
        @Param('substitutionId', ParseUUIDPipe) substitutionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >(
            new CancelClassSubstitutionFeature(
                workspaceId,
                substitutionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
