import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    STAFF_ROLES,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetCoachAnalyticsFeature,
    GetCoachAnalyticsFeatureResponse,
    GetCoachAnalyticsInputSchema,
    GetCoachAnalyticsOutputSchema,
} from './get-coach-analytics.feature'
import {
    GetCohortRetentionFeature,
    GetCohortRetentionFeatureResponse,
    GetCohortRetentionInputSchema,
    GetCohortRetentionOutputSchema,
} from './get-cohort-retention.feature'
import {
    GetRevenueForecastFeature,
    GetRevenueForecastFeatureResponse,
    GetRevenueForecastInputSchema,
    GetRevenueForecastOutputSchema,
} from './get-revenue-forecast.feature'
import {
    GetScheduleOccupancyFeature,
    GetScheduleOccupancyFeatureResponse,
    GetScheduleOccupancyInputSchema,
    GetScheduleOccupancyOutputSchema,
} from './get-schedule-occupancy.feature'
import {
    ListChurnRiskFeature,
    ListChurnRiskFeatureResponse,
    ListChurnRiskInputSchema,
    ListChurnRiskOutputSchema,
} from './list-churn-risk.feature'
import {
    RefreshAnalyticsFeature,
    RefreshAnalyticsFeatureResponse,
    RefreshAnalyticsOutputSchema,
} from './refresh-analytics.feature'

class ListChurnRiskQuery extends createZodDto(ListChurnRiskInputSchema) {}
class ListChurnRiskOutput extends createZodDto(ListChurnRiskOutputSchema) {}
class GetCohortRetentionQuery extends createZodDto(GetCohortRetentionInputSchema) {}
class GetCohortRetentionOutput extends createZodDto(GetCohortRetentionOutputSchema) {}
class GetScheduleOccupancyQuery extends createZodDto(GetScheduleOccupancyInputSchema) {}
class GetScheduleOccupancyOutput extends createZodDto(GetScheduleOccupancyOutputSchema) {}
class GetCoachAnalyticsQuery extends createZodDto(GetCoachAnalyticsInputSchema) {}
class GetCoachAnalyticsOutput extends createZodDto(GetCoachAnalyticsOutputSchema) {}
class GetRevenueForecastQuery extends createZodDto(GetRevenueForecastInputSchema) {}
class GetRevenueForecastOutput extends createZodDto(GetRevenueForecastOutputSchema) {}
class RefreshAnalyticsOutput extends createZodDto(RefreshAnalyticsOutputSchema) {}

// «Аналитика» (docs/design/2026-11-01-smart-analytics.md). Reads are staff-wide
// and scoped in the handlers (analytics-scope.ts): admins the whole club,
// coaches and direction managers their own groups.
@Controller('workspaces/:workspaceId/analytics')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubAnalyticsController {
    constructor(private bus: FeaturesBus) {}

    @Get('churn')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListChurnRiskOutput })
    async listChurnRisk(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListChurnRiskQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListChurnRiskFeature, ListChurnRiskFeatureResponse>(
            new ListChurnRiskFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('cohorts')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetCohortRetentionOutput })
    async getCohortRetention(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetCohortRetentionQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetCohortRetentionFeature, GetCohortRetentionFeatureResponse>(
            new GetCohortRetentionFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('occupancy')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetScheduleOccupancyOutput })
    async getScheduleOccupancy(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetScheduleOccupancyQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetScheduleOccupancyFeature, GetScheduleOccupancyFeatureResponse>(
            new GetScheduleOccupancyFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('coaches')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetCoachAnalyticsOutput })
    async getCoachAnalytics(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetCoachAnalyticsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetCoachAnalyticsFeature, GetCoachAnalyticsFeatureResponse>(
            new GetCoachAnalyticsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('forecast')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetRevenueForecastOutput })
    async getRevenueForecast(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetRevenueForecastQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetRevenueForecastFeature, GetRevenueForecastFeatureResponse>(
            new GetRevenueForecastFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('refresh')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RefreshAnalyticsOutput })
    async refreshAnalytics(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<RefreshAnalyticsFeature, RefreshAnalyticsFeatureResponse>(
            new RefreshAnalyticsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
