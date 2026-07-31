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

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import { DateRange, ExportService } from './export.service'

// Optional YYYY-MM-DD bounds for the attendance/revenue exports. The Zod pipe
// rejects a malformed value with a 400; both absent = full export.
const ExportRangeQuerySchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
})
class ExportRangeQuery extends createZodDto(ExportRangeQuerySchema) {}

// Build an inclusive range (from = start of that day, to = end of that day, UTC).
const toRange = (q: ExportRangeQuery): DateRange => ({
    ...(q.from ? { from: new Date(`${q.from}T00:00:00.000Z`) } : {}),
    ...(q.to ? { to: new Date(`${q.to}T23:59:59.999Z`) } : {}),
})

const attach = (res: Response, name: string, range: DateRange) => {
    // Name the file after the range when one is set, else today's date.
    const suffix =
        range.from || range.to
            ? [range.from, range.to]
                  .map((d) => (d ? d.toISOString().slice(0, 10) : '_'))
                  .join('_')
            : new Date().toISOString().slice(0, 10)
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name}-${suffix}.csv"`,
    )
}

// CSV exports for accounting/roster. Admin-only (member contacts + revenue are
// sensitive). Returns raw text/csv, so no ZodResponse — like the manifest proxy.
@Controller('workspaces/:workspaceId/exports')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ExportController {
    constructor(private readonly exportService: ExportService) {}

    @Get('members.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async members(
        @Param('workspaceId') workspaceId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'members', {})
        return await this.exportService.membersCsv(workspaceId)
    }

    @Get('renewals.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async renewals(
        @Param('workspaceId') workspaceId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'renewals', {})
        return await this.exportService.renewalsCsv(workspaceId)
    }

    @Get('attendance.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async attendance(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ExportRangeQuery,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        const range = toRange(query)
        attach(res, 'attendance', range)
        return await this.exportService.attendanceCsv(workspaceId, range)
    }

    @Get('revenue.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async revenue(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ExportRangeQuery,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        const range = toRange(query)
        attach(res, 'revenue', range)
        return await this.exportService.revenueCsv(workspaceId, range)
    }
}
