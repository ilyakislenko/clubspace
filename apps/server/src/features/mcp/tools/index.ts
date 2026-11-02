import type { McpTool } from '../mcp-tool'
import { clubDirectoryTool, clubOverviewTool } from './club-tools'
import { atRiskMembersTool, memberProfileTool, searchMembersTool } from './member-tools'
import {
    abonementStatesTool,
    renewalsDueTool,
    revenueReportTool,
    unpaidAbonementsTool,
} from './money-tools'
import { rankDistributionTool, upcomingGradingsTool } from './rank-tools'
import {
    attendanceStatsTool,
    coachStatsTool,
    listEventsTool,
    scheduleOccupancyTool,
    scheduleTool,
} from './schedule-tools'

// Every read-only tool, in the order tools/list presents them.
export const MCP_READ_TOOLS: readonly McpTool[] = [
    clubDirectoryTool,
    clubOverviewTool,
    revenueReportTool,
    searchMembersTool,
    memberProfileTool,
    atRiskMembersTool,
    renewalsDueTool,
    unpaidAbonementsTool,
    abonementStatesTool,
    scheduleTool,
    attendanceStatsTool,
    scheduleOccupancyTool,
    coachStatsTool,
    rankDistributionTool,
    upcomingGradingsTool,
    listEventsTool,
]
