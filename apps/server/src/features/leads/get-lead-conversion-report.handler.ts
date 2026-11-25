import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadLeadConversion } from '../../domains/leads/lead-report'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDayRange } from '../../shared/utils/local-day-range'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GetLeadConversionReportFeature,
    type GetLeadConversionReportFeatureResponse,
    LEAD_REPORT_DEFAULT_DAYS,
} from './get-lead-conversion-report.feature'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, loadLeadClub } from './leads-utils'

const shiftDate = (date: string, days: number): string => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}

@Feature(GetLeadConversionReportFeature)
export class GetLeadConversionReportHandler
    implements
        IFeatureHandler<GetLeadConversionReportFeature, GetLeadConversionReportFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: GetLeadConversionReportFeature,
    ): Promise<GetLeadConversionReportFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { timezone } = await loadLeadClub(this.prisma, f.workspaceId)
        const to = f.payload.to ?? localDateInTz(f.now, timezone)
        const from = f.payload.from ?? shiftDate(to, -(LEAD_REPORT_DEFAULT_DAYS - 1))
        if (from > to) {
            throw new BadRequestError({ message: 'Начало периода позже конца' })
        }
        const range = localDayRange({ from, to }, timezone)
        const report = await loadLeadConversion(this.prisma, {
            workspaceId: f.workspaceId,
            from: range?.gte,
            to: range?.lte,
        })
        return { from, to, ...report }
    }
}
