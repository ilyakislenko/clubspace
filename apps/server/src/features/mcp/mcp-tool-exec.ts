// Running one read-only ИИ-ассистент tool for a caller already authorized
// (resolveAiAccess): the steps the MCP server and the admin chat share — which
// tools the scope sees, the admin-only refusal, argument validation, the tool
// context, and turning a refusal or a crash into a result the model can read.
import type { Logger } from '@nestjs/common'
import type { FeaturesBus } from '@shelfjs/features'

import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import type { PrismaService } from '../../infrastructure/prisma'
import { DefaultError } from '../../shared/errors/default.error'
import type { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import type { McpPeople } from './mcp-people'
import { McpScope } from './mcp-scope'
import { ADMIN_ONLY_TOOL_MESSAGE, type McpTool, type McpToolContext, McpToolError } from './mcp-tool'
import { MCP_READ_TOOLS } from './tools'

export type ToolCallResult = {
    content: { type: 'text'; text: string }[]
    structuredContent?: Record<string, unknown>
    isError: boolean
}

export type ToolOutcome = { result: ToolCallResult; rows: number }

export const toolError = (message: string): ToolCallResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
})

export const toolSuccess = (data: Record<string, unknown>): ToolCallResult => ({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
})

// A direction manager's scope doesn't list the money tools.
export const visibleReadTools = (access: AiAccess): McpTool[] =>
    MCP_READ_TOOLS.filter((t) => access.directionIds === null || !t.adminOnly)

export type ToolDeps = {
    prisma: PrismaService
    schedule: GetWorkspaceScheduleHandler
    bus: FeaturesBus
}

export const buildToolContext = (
    deps: ToolDeps,
    access: AiAccess,
    people: McpPeople,
    now = new Date(),
): McpToolContext => ({
    prisma: deps.prisma,
    access,
    scope: new McpScope(access),
    people,
    now,
    schedule: deps.schedule,
    bus: deps.bus,
})

// The admin-only refusal and zod validation, before anything runs.
export const checkToolArgs = (
    tool: McpTool,
    args: Record<string, unknown>,
    access: AiAccess,
): { data: Record<string, unknown> } | { error: ToolCallResult } => {
    if (tool.adminOnly && access.directionIds !== null) {
        return { error: toolError(ADMIN_ONLY_TOOL_MESSAGE) }
    }
    const parsed = tool.input.safeParse(args)
    if (!parsed.success) {
        const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
            .join('; ')
        return { error: toolError(`Некорректные аргументы — ${issues}`) }
    }
    return { data: parsed.data as Record<string, unknown> }
}

// A refusal the model can act on keeps its message; anything else is logged
// and answered with a generic line (no stack traces to an AI provider).
export const toolFailure = (error: unknown, tool: McpTool, logger: Logger): ToolCallResult => {
    if (error instanceof McpToolError || error instanceof DefaultError) {
        return toolError(error.message)
    }
    logger.error(
        `ИИ-ассистент: tool ${tool.name} failed`,
        error instanceof Error ? error.stack : String(error),
    )
    return toolError('Внутренняя ошибка сервера ClubSpace — попробуйте позже')
}

// One read tool, start to finish.
export const runReadTool = async (
    ctx: McpToolContext,
    tool: McpTool,
    args: Record<string, unknown>,
    logger: Logger,
): Promise<ToolOutcome> => {
    const checked = checkToolArgs(tool, args, ctx.access)
    if ('error' in checked) return { result: checked.error, rows: 0 }
    try {
        const { data, rows } = await tool.run(ctx, checked.data)
        return { result: toolSuccess(data), rows }
    } catch (error) {
        return { result: toolFailure(error, tool, logger), rows: 0 }
    }
}
