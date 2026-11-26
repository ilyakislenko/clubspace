import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles, STAFF_ROLES } from '../../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { RoleGuard } from '../../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../../shared/guards/workspace-member.guard'
import {
    ConfirmTournamentEntryFeature,
    ConfirmTournamentEntryInputSchema,
    ConfirmTournamentEntryOutputSchema,
    type ConfirmTournamentEntryFeatureResponse,
    DeclareTournamentEntryFeature,
    DeclareTournamentEntryInputSchema,
    DeclareTournamentEntryOutputSchema,
    type DeclareTournamentEntryFeatureResponse,
    GetClubTournamentBracketFeature,
    GetClubTournamentBracketOutputSchema,
    type GetClubTournamentBracketFeatureResponse,
    GetClubTournamentFeature,
    GetClubTournamentOutputSchema,
    type GetClubTournamentFeatureResponse,
    GetClubTournamentResultsFeature,
    GetClubTournamentResultsOutputSchema,
    type GetClubTournamentResultsFeatureResponse,
    ListClubTournamentAthletesFeature,
    ListClubTournamentAthletesOutputSchema,
    type ListClubTournamentAthletesFeatureResponse,
} from './club-tournaments.feature'

class GetClubTournamentOutput extends createZodDto(GetClubTournamentOutputSchema) {}
class DeclareTournamentEntryInput extends createZodDto(DeclareTournamentEntryInputSchema) {}
class DeclareTournamentEntryOutput extends createZodDto(DeclareTournamentEntryOutputSchema) {}
class ConfirmTournamentEntryInput extends createZodDto(ConfirmTournamentEntryInputSchema) {}
class ConfirmTournamentEntryOutput extends createZodDto(ConfirmTournamentEntryOutputSchema) {}
class ListClubTournamentAthletesOutput extends createZodDto(
    ListClubTournamentAthletesOutputSchema,
) {}
class GetClubTournamentBracketOutput extends createZodDto(GetClubTournamentBracketOutputSchema) {}
class GetClubTournamentResultsOutput extends createZodDto(GetClubTournamentResultsOutputSchema) {}

// Federation tournaments in a member club's app (design
// docs/design/2026-11-27-tournaments.md §5.2). Member routes carry no @Roles
// (any member; a guardian acting for a child included) — the handlers do the
// rules; confirming is coach-tiered, the athletes list staff-tiered.
@Controller('workspaces/:workspaceId')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubTournamentsController {
    constructor(private bus: FeaturesBus) {}

    @Get('org-events/:eventId/tournament')
    @ZodResponse({ type: GetClubTournamentOutput })
    async getClubTournament(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetClubTournamentFeature, GetClubTournamentFeatureResponse>(
            new GetClubTournamentFeature(
                workspaceId,
                eventId,
                user.userId,
                user.guardianId ?? null,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put('org-events/:eventId/tournament/entry')
    @ZodResponse({ type: DeclareTournamentEntryOutput })
    async declareTournamentEntry(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Body() body: DeclareTournamentEntryInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeclareTournamentEntryFeature,
            DeclareTournamentEntryFeatureResponse
        >(
            new DeclareTournamentEntryFeature(
                body,
                workspaceId,
                eventId,
                user.userId,
                user.guardianId ?? null,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('tournament-entries/:entryId/confirm')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ConfirmTournamentEntryOutput })
    async confirmTournamentEntry(
        @Param('workspaceId') workspaceId: string,
        @Param('entryId', ParseUUIDPipe) entryId: string,
        @Body() body: ConfirmTournamentEntryInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ConfirmTournamentEntryFeature,
            ConfirmTournamentEntryFeatureResponse
        >(
            new ConfirmTournamentEntryFeature(
                body,
                workspaceId,
                entryId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('org-events/:eventId/tournament/athletes')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListClubTournamentAthletesOutput })
    async listClubTournamentAthletes(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListClubTournamentAthletesFeature,
            ListClubTournamentAthletesFeatureResponse
        >(
            new ListClubTournamentAthletesFeature(
                workspaceId,
                eventId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('org-events/:eventId/tournament/divisions/:divisionId/bracket')
    @ZodResponse({ type: GetClubTournamentBracketOutput })
    async getClubTournamentBracket(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Param('divisionId', ParseUUIDPipe) divisionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetClubTournamentBracketFeature,
            GetClubTournamentBracketFeatureResponse
        >(
            new GetClubTournamentBracketFeature(
                workspaceId,
                eventId,
                divisionId,
                user.userId,
                user.role?.name ?? null,
            ),
        )
    }

    @Get('org-events/:eventId/tournament/results')
    @ZodResponse({ type: GetClubTournamentResultsOutput })
    async getClubTournamentResults(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetClubTournamentResultsFeature,
            GetClubTournamentResultsFeatureResponse
        >(
            new GetClubTournamentResultsFeature(
                workspaceId,
                eventId,
                user.userId,
                user.role?.name ?? null,
            ),
        )
    }
}
