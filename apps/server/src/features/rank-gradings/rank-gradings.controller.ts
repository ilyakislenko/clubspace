import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
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
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddRankGradingCandidatesFeature,
    AddRankGradingCandidatesInputSchema,
    AddRankGradingCandidatesOutputSchema,
    type AddRankGradingCandidatesFeatureResponse,
} from './add-rank-grading-candidates.feature'
import {
    CreateRankGradingFeature,
    CreateRankGradingInputSchema,
    CreateRankGradingOutputSchema,
    type CreateRankGradingFeatureResponse,
} from './create-rank-grading.feature'
import {
    DeleteRankGradingFeature,
    DeleteRankGradingOutputSchema,
    type DeleteRankGradingFeatureResponse,
} from './delete-rank-grading.feature'
import {
    GetRankGradingFeature,
    GetRankGradingOutputSchema,
    type GetRankGradingFeatureResponse,
} from './get-rank-grading.feature'
import {
    ListRankGradingsFeature,
    ListRankGradingsInputSchema,
    ListRankGradingsOutputSchema,
    type ListRankGradingsFeatureResponse,
} from './list-rank-gradings.feature'
import {
    RecordRankGradingResultsFeature,
    RecordRankGradingResultsInputSchema,
    RecordRankGradingResultsOutputSchema,
    type RecordRankGradingResultsFeatureResponse,
} from './record-rank-grading-results.feature'
import {
    RemoveRankGradingCandidateFeature,
    RemoveRankGradingCandidateOutputSchema,
    type RemoveRankGradingCandidateFeatureResponse,
} from './remove-rank-grading-candidate.feature'
import {
    UpdateRankGradingCandidateFeature,
    UpdateRankGradingCandidateInputSchema,
    UpdateRankGradingCandidateOutputSchema,
    type UpdateRankGradingCandidateFeatureResponse,
} from './update-rank-grading-candidate.feature'
import {
    UpdateRankGradingFeature,
    UpdateRankGradingInputSchema,
    UpdateRankGradingOutputSchema,
    type UpdateRankGradingFeatureResponse,
} from './update-rank-grading.feature'

class CreateRankGradingInput extends createZodDto(
    CreateRankGradingInputSchema,
) {}
class RankGradingDetailOutputDto extends createZodDto(
    CreateRankGradingOutputSchema,
) {}
class ListRankGradingsQuery extends createZodDto(ListRankGradingsInputSchema) {}
class ListRankGradingsOutput extends createZodDto(
    ListRankGradingsOutputSchema,
) {}
class GetRankGradingOutput extends createZodDto(GetRankGradingOutputSchema) {}
class UpdateRankGradingInput extends createZodDto(
    UpdateRankGradingInputSchema,
) {}
class UpdateRankGradingOutput extends createZodDto(
    UpdateRankGradingOutputSchema,
) {}
class DeleteRankGradingOutput extends createZodDto(
    DeleteRankGradingOutputSchema,
) {}
class AddRankGradingCandidatesInput extends createZodDto(
    AddRankGradingCandidatesInputSchema,
) {}
class AddRankGradingCandidatesOutput extends createZodDto(
    AddRankGradingCandidatesOutputSchema,
) {}
class UpdateRankGradingCandidateInput extends createZodDto(
    UpdateRankGradingCandidateInputSchema,
) {}
class UpdateRankGradingCandidateOutput extends createZodDto(
    UpdateRankGradingCandidateOutputSchema,
) {}
class RemoveRankGradingCandidateOutput extends createZodDto(
    RemoveRankGradingCandidateOutputSchema,
) {}
class RecordRankGradingResultsInput extends createZodDto(
    RecordRankGradingResultsInputSchema,
) {}
class RecordRankGradingResultsOutput extends createZodDto(
    RecordRankGradingResultsOutputSchema,
) {}

@Controller('workspaces/:workspaceId/rank-gradings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RankGradingsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RankGradingDetailOutputDto })
    async createRankGrading(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateRankGradingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateRankGradingFeature,
            CreateRankGradingFeatureResponse
        >(
            new CreateRankGradingFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListRankGradingsOutput })
    async listRankGradings(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListRankGradingsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListRankGradingsFeature,
            ListRankGradingsFeatureResponse
        >(
            new ListRankGradingsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':gradingId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: GetRankGradingOutput })
    async getRankGrading(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetRankGradingFeature,
            GetRankGradingFeatureResponse
        >(
            new GetRankGradingFeature(
                workspaceId,
                gradingId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':gradingId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateRankGradingOutput })
    async updateRankGrading(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @Body() body: UpdateRankGradingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateRankGradingFeature,
            UpdateRankGradingFeatureResponse
        >(
            new UpdateRankGradingFeature(
                body,
                workspaceId,
                gradingId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':gradingId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DeleteRankGradingOutput })
    async deleteRankGrading(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteRankGradingFeature,
            DeleteRankGradingFeatureResponse
        >(
            new DeleteRankGradingFeature(
                workspaceId,
                gradingId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':gradingId/candidates')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: AddRankGradingCandidatesOutput })
    async addRankGradingCandidates(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @Body() body: AddRankGradingCandidatesInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            AddRankGradingCandidatesFeature,
            AddRankGradingCandidatesFeatureResponse
        >(
            new AddRankGradingCandidatesFeature(
                body,
                workspaceId,
                gradingId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':gradingId/candidates/:candidateId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateRankGradingCandidateOutput })
    async updateRankGradingCandidate(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @Param('candidateId') candidateId: string,
        @Body() body: UpdateRankGradingCandidateInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateRankGradingCandidateFeature,
            UpdateRankGradingCandidateFeatureResponse
        >(
            new UpdateRankGradingCandidateFeature(
                body,
                workspaceId,
                gradingId,
                candidateId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':gradingId/candidates/:candidateId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RemoveRankGradingCandidateOutput })
    async removeRankGradingCandidate(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @Param('candidateId') candidateId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RemoveRankGradingCandidateFeature,
            RemoveRankGradingCandidateFeatureResponse
        >(
            new RemoveRankGradingCandidateFeature(
                workspaceId,
                gradingId,
                candidateId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':gradingId/results')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RecordRankGradingResultsOutput })
    async recordRankGradingResults(
        @Param('workspaceId') workspaceId: string,
        @Param('gradingId') gradingId: string,
        @Body() body: RecordRankGradingResultsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RecordRankGradingResultsFeature,
            RecordRankGradingResultsFeatureResponse
        >(
            new RecordRankGradingResultsFeature(
                body,
                workspaceId,
                gradingId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
