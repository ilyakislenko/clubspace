import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { ORG_ADMINS, ORG_STAFF, OrgRoles } from '../../../shared/decorators/org-roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { OrganizationMemberGuard } from '../../../shared/guards/organization-member.guard'
import {
    AssignTournamentMatsFeature,
    type AssignTournamentMatsFeatureResponse,
    CopyTournamentDivisionsFeature,
    CopyTournamentDivisionsInputSchema,
    type CopyTournamentDivisionsFeatureResponse,
    CreateTournamentDivisionsFeature,
    CreateTournamentDivisionsInputSchema,
    type CreateTournamentDivisionsFeatureResponse,
    DeleteTournamentDivisionFeature,
    DeleteTournamentDivisionOutputSchema,
    type DeleteTournamentDivisionFeatureResponse,
    ListTournamentDivisionsFeature,
    type ListTournamentDivisionsFeatureResponse,
    UpdateTournamentDivisionFeature,
    UpdateTournamentDivisionInputSchema,
    UpdateTournamentDivisionOutputSchema,
    type UpdateTournamentDivisionFeatureResponse,
} from './divisions.feature'
import {
    ListTournamentEntriesFeature,
    ListTournamentEntriesInputSchema,
    ListTournamentEntriesOutputSchema,
    type ListTournamentEntriesFeatureResponse,
    MoveTournamentEntryFeature,
    MoveTournamentEntryInputSchema,
    MoveTournamentEntryOutputSchema,
    type MoveTournamentEntryFeatureResponse,
    RecordTournamentWeighInFeature,
    RecordTournamentWeighInInputSchema,
    RecordTournamentWeighInOutputSchema,
    type RecordTournamentWeighInFeatureResponse,
    SetTournamentEntryWithdrawnFeature,
    SetTournamentEntryWithdrawnInputSchema,
    SetTournamentEntryWithdrawnOutputSchema,
    type SetTournamentEntryWithdrawnFeatureResponse,
} from './entries.feature'
import {
    DrawTournamentDivisionFeature,
    type DrawTournamentDivisionFeatureResponse,
    GetTournamentBracketFeature,
    type GetTournamentBracketFeatureResponse,
    GetTournamentMatQueueFeature,
    type GetTournamentMatQueueFeatureResponse,
    GetTournamentResultsFeature,
    type GetTournamentResultsFeatureResponse,
    RecordTournamentMatchResultFeature,
    RecordTournamentMatchResultInputSchema,
    type RecordTournamentMatchResultFeatureResponse,
    UndoTournamentMatchResultFeature,
    UndoTournamentMatchResultInputSchema,
    type UndoTournamentMatchResultFeatureResponse,
} from './matches.feature'
import {
    TournamentBracketOutputSchema,
    TournamentDivisionListOutputSchema,
    TournamentMatQueueOutputSchema,
    TournamentResultsOutputSchema,
} from './schemas'
import {
    CreateOrgTournamentFeature,
    CreateOrgTournamentInputSchema,
    CreateOrgTournamentOutputSchema,
    type CreateOrgTournamentFeatureResponse,
    GetOrgTournamentFeature,
    GetOrgTournamentOutputSchema,
    type GetOrgTournamentFeatureResponse,
    PublishOrgTournamentResultsFeature,
    PublishOrgTournamentResultsInputSchema,
    PublishOrgTournamentResultsOutputSchema,
    type PublishOrgTournamentResultsFeatureResponse,
    SetOrgTournamentStatusFeature,
    SetOrgTournamentStatusInputSchema,
    SetOrgTournamentStatusOutputSchema,
    type SetOrgTournamentStatusFeatureResponse,
    UpdateOrgTournamentFeature,
    UpdateOrgTournamentInputSchema,
    UpdateOrgTournamentOutputSchema,
    type UpdateOrgTournamentFeatureResponse,
} from './tournament.feature'

class CreateOrgTournamentInput extends createZodDto(CreateOrgTournamentInputSchema) {}
class CreateOrgTournamentOutput extends createZodDto(CreateOrgTournamentOutputSchema) {}
class GetOrgTournamentOutput extends createZodDto(GetOrgTournamentOutputSchema) {}
class UpdateOrgTournamentInput extends createZodDto(UpdateOrgTournamentInputSchema) {}
class UpdateOrgTournamentOutput extends createZodDto(UpdateOrgTournamentOutputSchema) {}
class SetOrgTournamentStatusInput extends createZodDto(SetOrgTournamentStatusInputSchema) {}
class SetOrgTournamentStatusOutput extends createZodDto(SetOrgTournamentStatusOutputSchema) {}
class PublishOrgTournamentResultsInput extends createZodDto(
    PublishOrgTournamentResultsInputSchema,
) {}
class PublishOrgTournamentResultsOutput extends createZodDto(
    PublishOrgTournamentResultsOutputSchema,
) {}
class TournamentDivisionListOutput extends createZodDto(TournamentDivisionListOutputSchema) {}
class CreateTournamentDivisionsInput extends createZodDto(CreateTournamentDivisionsInputSchema) {}
class CopyTournamentDivisionsInput extends createZodDto(CopyTournamentDivisionsInputSchema) {}
class UpdateTournamentDivisionInput extends createZodDto(UpdateTournamentDivisionInputSchema) {}
class UpdateTournamentDivisionOutput extends createZodDto(UpdateTournamentDivisionOutputSchema) {}
class DeleteTournamentDivisionOutput extends createZodDto(DeleteTournamentDivisionOutputSchema) {}
class ListTournamentEntriesQuery extends createZodDto(ListTournamentEntriesInputSchema) {}
class ListTournamentEntriesOutput extends createZodDto(ListTournamentEntriesOutputSchema) {}
class RecordTournamentWeighInInput extends createZodDto(RecordTournamentWeighInInputSchema) {}
class RecordTournamentWeighInOutput extends createZodDto(RecordTournamentWeighInOutputSchema) {}
class MoveTournamentEntryInput extends createZodDto(MoveTournamentEntryInputSchema) {}
class MoveTournamentEntryOutput extends createZodDto(MoveTournamentEntryOutputSchema) {}
class SetTournamentEntryWithdrawnInput extends createZodDto(
    SetTournamentEntryWithdrawnInputSchema,
) {}
class SetTournamentEntryWithdrawnOutput extends createZodDto(
    SetTournamentEntryWithdrawnOutputSchema,
) {}
class TournamentBracketOutput extends createZodDto(TournamentBracketOutputSchema) {}
class TournamentMatQueueOutput extends createZodDto(TournamentMatQueueOutputSchema) {}
class RecordTournamentMatchResultInput extends createZodDto(
    RecordTournamentMatchResultInputSchema,
) {}
class UndoTournamentMatchResultInput extends createZodDto(UndoTournamentMatchResultInputSchema) {}
class TournamentResultsOutput extends createZodDto(TournamentResultsOutputSchema) {}

// Federation tournaments in the org console (design
// docs/design/2026-11-27-tournaments.md §5.1): org coaches run the day
// (divisions, weigh-in, draw, results), org admins create the tournament and
// publish results.
@Controller('orgs/:organizationId')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrgTournamentsController {
    constructor(private bus: FeaturesBus) {}

    @Post('events/:eventId/tournament')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: CreateOrgTournamentOutput })
    async createOrgTournament(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Body() body: CreateOrgTournamentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreateOrgTournamentFeature, CreateOrgTournamentFeatureResponse>(
            new CreateOrgTournamentFeature(
                body,
                organizationId,
                eventId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: GetOrgTournamentOutput })
    async getOrgTournament(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetOrgTournamentFeature, GetOrgTournamentFeatureResponse>(
            new GetOrgTournamentFeature(
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch('tournaments/:tournamentId')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: UpdateOrgTournamentOutput })
    async updateOrgTournament(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Body() body: UpdateOrgTournamentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateOrgTournamentFeature, UpdateOrgTournamentFeatureResponse>(
            new UpdateOrgTournamentFeature(
                body,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/status')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: SetOrgTournamentStatusOutput })
    async setOrgTournamentStatus(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Body() body: SetOrgTournamentStatusInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            SetOrgTournamentStatusFeature,
            SetOrgTournamentStatusFeatureResponse
        >(
            new SetOrgTournamentStatusFeature(
                body,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/publication')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: PublishOrgTournamentResultsOutput })
    async publishOrgTournamentResults(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Body() body: PublishOrgTournamentResultsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            PublishOrgTournamentResultsFeature,
            PublishOrgTournamentResultsFeatureResponse
        >(
            new PublishOrgTournamentResultsFeature(
                body,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId/divisions')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentDivisionListOutput })
    async listTournamentDivisions(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListTournamentDivisionsFeature,
            ListTournamentDivisionsFeatureResponse
        >(
            new ListTournamentDivisionsFeature(
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/divisions')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentDivisionListOutput })
    async createTournamentDivisions(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Body() body: CreateTournamentDivisionsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateTournamentDivisionsFeature,
            CreateTournamentDivisionsFeatureResponse
        >(
            new CreateTournamentDivisionsFeature(
                body,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/divisions/copy')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentDivisionListOutput })
    async copyTournamentDivisions(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Body() body: CopyTournamentDivisionsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CopyTournamentDivisionsFeature,
            CopyTournamentDivisionsFeatureResponse
        >(
            new CopyTournamentDivisionsFeature(
                body,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch('tournaments/:tournamentId/divisions/:divisionId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: UpdateTournamentDivisionOutput })
    async updateTournamentDivision(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('divisionId', ParseUUIDPipe) divisionId: string,
        @Body() body: UpdateTournamentDivisionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateTournamentDivisionFeature,
            UpdateTournamentDivisionFeatureResponse
        >(
            new UpdateTournamentDivisionFeature(
                body,
                organizationId,
                tournamentId,
                divisionId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('tournaments/:tournamentId/divisions/:divisionId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: DeleteTournamentDivisionOutput })
    async deleteTournamentDivision(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('divisionId', ParseUUIDPipe) divisionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteTournamentDivisionFeature,
            DeleteTournamentDivisionFeatureResponse
        >(
            new DeleteTournamentDivisionFeature(
                organizationId,
                tournamentId,
                divisionId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/mats/assign')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentDivisionListOutput })
    async assignTournamentMats(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<AssignTournamentMatsFeature, AssignTournamentMatsFeatureResponse>(
            new AssignTournamentMatsFeature(
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId/entries')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListTournamentEntriesOutput })
    async listTournamentEntries(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Query() query: ListTournamentEntriesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListTournamentEntriesFeature,
            ListTournamentEntriesFeatureResponse
        >(
            new ListTournamentEntriesFeature(
                query,
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Put('tournaments/:tournamentId/entries/:entryId/weigh-in')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: RecordTournamentWeighInOutput })
    async recordTournamentWeighIn(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @Body() body: RecordTournamentWeighInInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RecordTournamentWeighInFeature,
            RecordTournamentWeighInFeatureResponse
        >(
            new RecordTournamentWeighInFeature(
                body,
                organizationId,
                tournamentId,
                entryId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/entries/:entryId/move')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: MoveTournamentEntryOutput })
    async moveTournamentEntry(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @Body() body: MoveTournamentEntryInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<MoveTournamentEntryFeature, MoveTournamentEntryFeatureResponse>(
            new MoveTournamentEntryFeature(
                body,
                organizationId,
                tournamentId,
                entryId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/entries/:entryId/withdrawal')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: SetTournamentEntryWithdrawnOutput })
    async setTournamentEntryWithdrawn(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @Body() body: SetTournamentEntryWithdrawnInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            SetTournamentEntryWithdrawnFeature,
            SetTournamentEntryWithdrawnFeatureResponse
        >(
            new SetTournamentEntryWithdrawnFeature(
                body,
                organizationId,
                tournamentId,
                entryId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/divisions/:divisionId/draw')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentBracketOutput })
    async drawTournamentDivision(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('divisionId', ParseUUIDPipe) divisionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DrawTournamentDivisionFeature,
            DrawTournamentDivisionFeatureResponse
        >(
            new DrawTournamentDivisionFeature(
                organizationId,
                tournamentId,
                divisionId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId/divisions/:divisionId/bracket')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentBracketOutput })
    async getTournamentBracket(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('divisionId', ParseUUIDPipe) divisionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetTournamentBracketFeature, GetTournamentBracketFeatureResponse>(
            new GetTournamentBracketFeature(
                organizationId,
                tournamentId,
                divisionId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId/mats/:mat/queue')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentMatQueueOutput })
    async getTournamentMatQueue(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('mat', ParseIntPipe) mat: number,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetTournamentMatQueueFeature,
            GetTournamentMatQueueFeatureResponse
        >(
            new GetTournamentMatQueueFeature(
                organizationId,
                tournamentId,
                mat,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/matches/:matchId/result')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentBracketOutput })
    async recordTournamentMatchResult(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('matchId', ParseUUIDPipe) matchId: string,
        @Body() body: RecordTournamentMatchResultInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RecordTournamentMatchResultFeature,
            RecordTournamentMatchResultFeatureResponse
        >(
            new RecordTournamentMatchResultFeature(
                body,
                organizationId,
                tournamentId,
                matchId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournaments/:tournamentId/matches/:matchId/undo')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentBracketOutput })
    async undoTournamentMatchResult(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @Param('matchId', ParseUUIDPipe) matchId: string,
        @Body() body: UndoTournamentMatchResultInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UndoTournamentMatchResultFeature,
            UndoTournamentMatchResultFeatureResponse
        >(
            new UndoTournamentMatchResultFeature(
                body,
                organizationId,
                tournamentId,
                matchId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('tournaments/:tournamentId/results')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: TournamentResultsOutput })
    async getTournamentResults(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetTournamentResultsFeature, GetTournamentResultsFeatureResponse>(
            new GetTournamentResultsFeature(
                organizationId,
                tournamentId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
