import {
    Controller,
    Get,
    Header,
    Param,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import type { Response } from 'express'
import { z } from 'zod'

import {
    type AuditAction,
    AuditService,
} from '../../domains/audit/services/audit.service'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import { DayRange, ExportService } from './export.service'

// Optional YYYY-MM-DD bounds for the attendance/revenue exports: inclusive
// club-local days (the service resolves them in the club's timezone). The Zod
// pipe rejects a malformed value with a 400; both absent = full export.
const ExportRangeQuerySchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
})
class ExportRangeQuery extends createZodDto(ExportRangeQuerySchema) {}

const attach = (res: Response, name: string, range: DayRange) => {
    // Name the file after the range when one is set, else today's date.
    const suffix =
        range.from || range.to
            ? [range.from ?? '_', range.to ?? '_'].join('_')
            : new Date().toISOString().slice(0, 10)
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name}-${suffix}.csv"`,
    )
}

// CSV exports for accounting/roster. Admin-only (member contacts + revenue are
// sensitive). Returns raw text/csv, so no ZodResponse — like the manifest proxy.
// Every download is written to the club's audit journal: bulk personal data
// leaving the system must leave a trail.
@Controller('workspaces/:workspaceId/exports')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ExportController {
    constructor(
        private readonly exportService: ExportService,
        private readonly audit: AuditService,
    ) {}

    // Records the download once the file is built, so a failed export leaves
    // no entry. The range is the one the file covers.
    private async audited(
        action: AuditAction,
        workspaceId: string,
        user: CurrentUserPayload,
        range: DayRange,
        csv: string,
    ): Promise<string> {
        await this.audit.record({
            action,
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: user.userId,
            metadata: {
                ...(range.from ? { from: range.from } : {}),
                ...(range.to ? { to: range.to } : {}),
            },
        })
        return csv
    }

    @Get('members.csv')
    @Roles(WORKSPACE_ADMINS)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async members(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'members', {})
        return await this.audited(
            'export.members',
            workspaceId,
            user,
            {},
            await this.exportService.membersCsv(workspaceId),
        )
    }

    @Get('renewals.csv')
    @Roles(WORKSPACE_ADMINS)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async renewals(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'renewals', {})
        return await this.audited(
            'export.renewals',
            workspaceId,
            user,
            {},
            await this.exportService.renewalsCsv(workspaceId),
        )
    }

    @Get('attendance.csv')
    @Roles(WORKSPACE_ADMINS)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async attendance(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ExportRangeQuery,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        const range: DayRange = query
        attach(res, 'attendance', range)
        return await this.audited(
            'export.attendance',
            workspaceId,
            user,
            range,
            await this.exportService.attendanceCsv(workspaceId, range),
        )
    }

    @Get('revenue.csv')
    @Roles(WORKSPACE_ADMINS)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async revenue(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ExportRangeQuery,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        const range: DayRange = query
        attach(res, 'revenue', range)
        return await this.audited(
            'export.revenue',
            workspaceId,
            user,
            range,
            await this.exportService.revenueCsv(workspaceId, range),
        )
    }
}
