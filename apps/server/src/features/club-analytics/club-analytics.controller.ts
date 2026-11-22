import { Controller, Get, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    CLUB_ADMINS,
    Roles,
    SPORT_LEADS,
    STAFF_ROLES,
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
    RefreshAnalyticsFeature,
    RefreshAnalyticsFeatureResponse,
    RefreshAnalyticsOutputSchema,
} from './refresh-analytics.feature'

class GetCohortRetentionQuery extends createZodDto(GetCohortRetentionInputSchema) {}
class GetCohortRetentionOutput extends createZodDto(GetCohortRetentionOutputSchema) {}
class GetScheduleOccupancyQuery extends createZodDto(GetScheduleOccupancyInputSchema) {}
class GetScheduleOccupancyOutput extends createZodDto(GetScheduleOccupancyOutputSchema) {}
class GetCoachAnalyticsQuery extends createZodDto(GetCoachAnalyticsInputSchema) {}
class GetCoachAnalyticsOutput extends createZodDto(GetCoachAnalyticsOutputSchema) {}
class GetRevenueForecastQuery extends createZodDto(GetRevenueForecastInputSchema) {}
class GetRevenueForecastOutput extends createZodDto(GetRevenueForecastOutputSchema) {}
class RefreshAnalyticsOutput extends createZodDto(RefreshAnalyticsOutputSchema) {}

export const REFRESH_ANALYTICS_PER_MINUTE = 5

// «Аналитика» (docs/design/2026-11-01-smart-analytics.md). Cohorts and
// occupancy are staff-wide and scoped in the handlers (analytics-scope.ts):
// sport leads the whole club, coaches and direction managers their own groups.
// Comparing coaches is for sport leads; the revenue forecast for club admins.
// «Кому позвонить» lives in at-risk-members.
@Controller('workspaces/:workspaceId/analytics')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubAnalyticsController {
    constructor(private bus: FeaturesBus) {}

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
    @Roles(SPORT_LEADS)
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
    @Roles(CLUB_ADMINS)
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

    // 202 while a rebuild is queued, 200 when the snapshots are fresh and
    // nothing was started. A few presses a minute per person: the work itself
    // is single-flight per club (refresh-analytics.processor.ts).
    @Post('refresh')
    @Roles(SPORT_LEADS)
    @Throttle({ default: { ttl: 60_000, limit: REFRESH_ANALYTICS_PER_MINUTE } })
    @ZodResponse({ status: HttpStatus.ACCEPTED, type: RefreshAnalyticsOutput })
    async refreshAnalytics(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.bus.execute<
            RefreshAnalyticsFeature,
            RefreshAnalyticsFeatureResponse
        >(
            new RefreshAnalyticsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
        if (result.status === 'fresh') res.status(HttpStatus.OK)
        return result
    }
}
