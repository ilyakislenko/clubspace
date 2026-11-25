import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
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
import { Roles, SPORT_LEADS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateLeadFeature,
    type CreateLeadFeatureResponse,
    CreateLeadInputSchema,
} from './create-lead.feature'
import { EraseLeadFeature, type EraseLeadFeatureResponse } from './erase-lead.feature'
import {
    GetLeadConversionReportFeature,
    type GetLeadConversionReportFeatureResponse,
    GetLeadConversionReportQuerySchema,
    LeadConversionReportOutputSchema,
} from './get-lead-conversion-report.feature'
import { GetLeadFeature, type GetLeadFeatureResponse, LeadOutputSchema } from './get-lead.feature'
import {
    GetTrialLinkFeature,
    type GetTrialLinkFeatureResponse,
    TrialLinkOutputSchema,
} from './get-trial-link.feature'
import {
    LinkLeadMemberFeature,
    type LinkLeadMemberFeatureResponse,
    LinkLeadMemberInputSchema,
} from './link-lead-member.feature'
import {
    ListLeadsFeature,
    type ListLeadsFeatureResponse,
    ListLeadsOutputSchema,
    ListLeadsQuerySchema,
} from './list-leads.feature'
import {
    SetLeadStatusFeature,
    type SetLeadStatusFeatureResponse,
    SetLeadStatusInputSchema,
} from './set-lead-status.feature'
import {
    UpdateLeadFeature,
    type UpdateLeadFeatureResponse,
    UpdateLeadInputSchema,
} from './update-lead.feature'

class ListLeadsQuery extends createZodDto(ListLeadsQuerySchema) {}
class ListLeadsOutput extends createZodDto(ListLeadsOutputSchema) {}
class LeadOutput extends createZodDto(LeadOutputSchema) {}
class CreateLeadInput extends createZodDto(CreateLeadInputSchema) {}
class UpdateLeadInput extends createZodDto(UpdateLeadInputSchema) {}
class SetLeadStatusInput extends createZodDto(SetLeadStatusInputSchema) {}
class LinkLeadMemberInput extends createZodDto(LinkLeadMemberInputSchema) {}
class LeadConversionReportQuery extends createZodDto(GetLeadConversionReportQuerySchema) {}
class LeadConversionReportOutput extends createZodDto(LeadConversionReportOutputSchema) {}
class TrialLinkOutput extends createZodDto(TrialLinkOutputSchema) {}

// «Ученики → Пробные» (docs/design/2026-11-26-leads.md §3.3): sport leads
// (owner, admin, head coach) — strangers' phones, the roster tier. Every
// handler re-asserts with assertSportLead.
@Controller('workspaces/:workspaceId/leads')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class LeadsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: ListLeadsOutput })
    async listLeads(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListLeadsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListLeadsFeature, ListLeadsFeatureResponse>(
            new ListLeadsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    // Before ':leadId' so the literal paths win.
    @Get('report')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadConversionReportOutput })
    async getLeadConversionReport(
        @Param('workspaceId') workspaceId: string,
        @Query() query: LeadConversionReportQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetLeadConversionReportFeature,
            GetLeadConversionReportFeatureResponse
        >(
            new GetLeadConversionReportFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('trial-link')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: TrialLinkOutput })
    async getTrialLink(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetTrialLinkFeature, GetTrialLinkFeatureResponse>(
            new GetTrialLinkFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':leadId')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async getLead(
        @Param('workspaceId') workspaceId: string,
        @Param('leadId', ParseUUIDPipe) leadId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetLeadFeature, GetLeadFeatureResponse>(
            new GetLeadFeature(
                workspaceId,
                leadId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async createLead(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateLeadInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<CreateLeadFeature, CreateLeadFeatureResponse>(
            new CreateLeadFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':leadId')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async updateLead(
        @Param('workspaceId') workspaceId: string,
        @Param('leadId', ParseUUIDPipe) leadId: string,
        @Body() body: UpdateLeadInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<UpdateLeadFeature, UpdateLeadFeatureResponse>(
            new UpdateLeadFeature(
                body,
                workspaceId,
                leadId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':leadId/status')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async setLeadStatus(
        @Param('workspaceId') workspaceId: string,
        @Param('leadId', ParseUUIDPipe) leadId: string,
        @Body() body: SetLeadStatusInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<SetLeadStatusFeature, SetLeadStatusFeatureResponse>(
            new SetLeadStatusFeature(
                body,
                workspaceId,
                leadId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':leadId/link')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async linkLeadMember(
        @Param('workspaceId') workspaceId: string,
        @Param('leadId', ParseUUIDPipe) leadId: string,
        @Body() body: LinkLeadMemberInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<LinkLeadMemberFeature, LinkLeadMemberFeatureResponse>(
            new LinkLeadMemberFeature(
                body,
                workspaceId,
                leadId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':leadId/erase')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: LeadOutput })
    async eraseLead(
        @Param('workspaceId') workspaceId: string,
        @Param('leadId', ParseUUIDPipe) leadId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<EraseLeadFeature, EraseLeadFeatureResponse>(
            new EraseLeadFeature(
                workspaceId,
                leadId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
