// The ИИ-ассистент's MCP server (docs/mcp.md): authenticates a club token,
// rate-limits it, dispatches one JSON-RPC message and audits every tool call.
// Returns the HTTP status, headers and body; the controller only writes them.
import { Inject, Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import type Redis from 'ioredis'

import { resolveAiAccess, type AiAccess } from '../../domains/ai-assistant/ai-access'
import {
    aiTokenState,
    ENABLED_AI_TOKEN_SCOPES,
    hashAiToken,
    looksLikeAiToken,
} from '../../domains/ai-assistant/ai-token'
import { AuditService } from '../../domains/audit/services/audit.service'
import { suspensionReason } from '../../domains/billing/billing-rules'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants'
import { RedisThrottlerStorage } from '../../infrastructure/redis/redis-throttler.storage'
import { DefaultError } from '../../shared/errors/default.error'
import { ForbiddenError, WorkspaceSuspendedError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import {
    ACTION_CONFIRMATION_TTL_MS,
    ACTIONS_SCOPE,
    MCP_ACTION_TOOLS,
    isActionTool,
    type McpActionTool,
    signActionConfirmation,
    verifyActionConfirmation,
} from './mcp-actions'
import { McpPeople, type AiDataMode } from './mcp-people'
import {
    isSupportedProtocolHeader,
    JSONRPC,
    type JsonRpcError,
    type JsonRpcId,
    type JsonRpcSuccess,
    MCP_PROTOCOL_VERSIONS,
    negotiateProtocolVersion,
    parseMcpMessage,
    rpcError,
    rpcResult,
} from './mcp-protocol'
import { McpScope } from './mcp-scope'
import {
    ADMIN_ONLY_TOOL_MESSAGE,
    type McpTool,
    type McpToolContext,
    McpToolError,
    summarizeArgs,
    toolInputJsonSchema,
} from './mcp-tool'
import { MCP_READ_TOOLS } from './tools'

export const MCP_SERVER_INFO = { name: 'clubspace', title: 'ClubSpace', version: '1.0.0' }

const LAST_USED_THROTTLE_MS = 60_000
const RATE_WINDOW_MS = 60_000

export type McpHttpOutcome = {
    status: number
    headers?: Record<string, string>
    // undefined = no body (202 Accepted).
    body?: JsonRpcSuccess | JsonRpcError
}

export type McpCaller = {
    token: {
        id: string
        name: string
        scopes: string[]
        dataMode: AiDataMode
        createdById: string
        creatorEmail: string | null
    }
    access: AiAccess
}

class McpHttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: number,
        message: string,
        readonly headers: Record<string, string> = {},
    ) {
        super(message)
    }
}

type ToolCallResult = {
    content: { type: 'text'; text: string }[]
    structuredContent?: Record<string, unknown>
    isError: boolean
}

const toolError = (message: string): ToolCallResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
})

@Injectable()
export class McpServerService {
    private readonly logger = new Logger(McpServerService.name)
    private readonly limiter: RedisThrottlerStorage

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly bus: FeaturesBus,
        private readonly schedule: GetWorkspaceScheduleHandler,
        @Inject(REDIS_CLIENT) redis: Redis,
    ) {
        this.limiter = new RedisThrottlerStorage(redis)
    }

    async handleHttp(req: {
        authorization: string | undefined
        protocolVersion: string | undefined
        body: unknown
    }): Promise<McpHttpOutcome> {
        let caller: McpCaller
        try {
            caller = await this.authenticate(req.authorization)
            await this.rateLimit(caller.token.id)
        } catch (error) {
            if (error instanceof McpHttpError) {
                return {
                    status: error.status,
                    headers: error.headers,
                    body: rpcError(null, error.code, error.message),
                }
            }
            throw error
        }

        if (!isSupportedProtocolHeader(req.protocolVersion)) {
            return {
                status: 400,
                body: rpcError(
                    null,
                    JSONRPC.INVALID_REQUEST,
                    `Неподдерживаемая версия протокола MCP: ${req.protocolVersion}. Поддерживаются: ${MCP_PROTOCOL_VERSIONS.join(', ')}`,
                ),
            }
        }

        const message = parseMcpMessage(req.body)
        if (message.kind === 'invalid') return { status: 400, body: message.error }
        // Notifications (initialized, cancelled) and replies need no answer.
        if (message.kind !== 'request') return { status: 202 }
        return { status: 200, body: await this.dispatch(caller, message.id, message.method, message.params) }
    }

    // ---- auth ----

    private async authenticate(authorization: string | undefined): Promise<McpCaller> {
        const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')
        const secret = match?.[1]
        const unauthorized = (message: string) =>
            new McpHttpError(401, JSONRPC.UNAUTHORIZED, message, {
                'WWW-Authenticate': 'Bearer realm="clubspace-mcp"',
            })
        if (!secret || !looksLikeAiToken(secret)) {
            throw unauthorized(
                'Нужен токен ИИ-ассистента: заголовок Authorization: Bearer csai_… (Интеграции → ИИ-ассистент в админке клуба)',
            )
        }
        const row = await this.prisma.aiAccessToken.findUnique({
            where: { tokenHash: hashAiToken(secret) },
            select: {
                id: true,
                workspaceId: true,
                name: true,
                scopes: true,
                dataMode: true,
                expiresAt: true,
                revokedAt: true,
                lastUsedAt: true,
                createdById: true,
                createdBy: { select: { status: true, email: true } },
                workspace: {
                    select: { name: true, isActive: true, billing: { select: { status: true } } },
                },
            },
        })
        if (!row) throw unauthorized('Токен не найден')
        const now = new Date()
        const state = aiTokenState(row, now)
        if (state === 'revoked') throw unauthorized('Токен отозван')
        if (state === 'expired') throw unauthorized('Срок действия токена истёк')
        if (row.createdBy.status !== 'ACTIVE') {
            throw unauthorized('Аккаунт создателя токена заблокирован или удалён')
        }

        let access: AiAccess
        try {
            access = await resolveAiAccess(this.prisma, this.rbac, {
                workspaceId: row.workspaceId,
                userId: row.createdById,
                now,
            })
            const reason = suspensionReason(row.workspace, environment.billing.enabled)
            if (reason) {
                throw new WorkspaceSuspendedError({
                    workspaceId: row.workspaceId,
                    workspaceName: row.workspace.name,
                    reason,
                })
            }
        } catch (error) {
            if (error instanceof ForbiddenError || error instanceof WorkspaceSuspendedError) {
                throw new McpHttpError(403, JSONRPC.FORBIDDEN, error.message)
            }
            throw error
        }

        // «Последнее использование» in the admin, at most one write a minute.
        if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
            await this.prisma.aiAccessToken.update({
                where: { id: row.id },
                data: { lastUsedAt: now },
            })
        }

        return {
            token: {
                id: row.id,
                name: row.name,
                scopes: row.scopes,
                dataMode: row.dataMode,
                createdById: row.createdById,
                creatorEmail: row.createdBy.email,
            },
            access,
        }
    }

    private async rateLimit(tokenId: string): Promise<void> {
        const limit = environment.ai.mcpRateLimitPerMinute
        const hit = await this.limiter.increment(
            `token:${tokenId}`,
            RATE_WINDOW_MS,
            limit,
            RATE_WINDOW_MS,
            'ai-mcp',
        )
        if (hit.isBlocked) {
            const retryAfter = Math.max(1, hit.timeToBlockExpire)
            throw new McpHttpError(
                429,
                JSONRPC.RATE_LIMITED,
                `Слишком много запросов: не больше ${limit} в минуту на токен. Повторите через ${retryAfter} с.`,
                { 'Retry-After': String(retryAfter) },
            )
        }
    }

    // ---- dispatch ----

    private async dispatch(
        caller: McpCaller,
        id: JsonRpcId,
        method: string,
        params: Record<string, unknown>,
    ): Promise<JsonRpcSuccess | JsonRpcError> {
        switch (method) {
            case 'initialize':
                return rpcResult(id, {
                    protocolVersion: negotiateProtocolVersion(params.protocolVersion),
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: MCP_SERVER_INFO,
                    instructions: this.instructions(caller),
                })
            case 'ping':
                return rpcResult(id, {})
            case 'tools/list':
                return rpcResult(id, {
                    tools: this.visibleTools(caller).map((t) => this.describeTool(t)),
                })
            case 'tools/call':
                return this.callTool(caller, id, params)
            default:
                return rpcError(id, JSONRPC.METHOD_NOT_FOUND, `Метод не поддерживается: ${method}`)
        }
    }

    private actionsEnabled(caller: McpCaller): boolean {
        return (
            caller.token.scopes.includes(ACTIONS_SCOPE) &&
            ENABLED_AI_TOKEN_SCOPES.includes(ACTIONS_SCOPE)
        )
    }

    // A direction manager's token doesn't list the money tools; action tools
    // only with the (not yet grantable) 'actions' scope.
    private visibleTools(caller: McpCaller): McpTool[] {
        const isAdmin = caller.access.directionIds === null
        return [
            ...MCP_READ_TOOLS,
            ...(this.actionsEnabled(caller) ? MCP_ACTION_TOOLS : []),
        ].filter((t) => isAdmin || !t.adminOnly)
    }

    private describeTool(tool: McpTool) {
        const isAction = isActionTool(tool)
        return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: toolInputJsonSchema(tool.input),
            annotations: {
                title: tool.title,
                readOnlyHint: !isAction,
                destructiveHint: isAction,
                idempotentHint: !isAction,
                openWorldHint: false,
            },
        }
    }

    private instructions(caller: McpCaller): string {
        const personal = caller.token.dataMode === 'PERSONAL'
        return [
            `ClubSpace — данные клуба «${caller.access.workspaceName}» (часовой пояс ${caller.access.timezone}), только чтение.`,
            caller.access.directionIds === null
                ? 'Доступ: весь клуб, включая выручку и долги.'
                : 'Доступ: только направления, которыми руководит владелец токена; финансовых инструментов нет.',
            personal
                ? 'Режим «с персональными данными»: имена и контакты участников доступны — не пересылайте их дальше без нужды.'
                : 'Режим «обезличено»: участники обозначены псевдонимами ref вида m_0123456789 (тренеры — c_…), имён, телефонов и e-mail нет. Используйте ref, чтобы спросить про конкретного участника.',
            'Начните с club_overview (сводка) и club_directory (id направлений, залов, групп, тарифов). Суммы — в целых единицах валюты клуба; время в расписании — местное время зала. Длинные списки постраничны: offset/limit, nextOffset.',
            'Отвечайте пользователю по-русски.',
        ].join('\n')
    }

    private async callTool(
        caller: McpCaller,
        id: JsonRpcId,
        params: Record<string, unknown>,
    ): Promise<JsonRpcSuccess | JsonRpcError> {
        const name = params.name
        const tool =
            typeof name === 'string'
                ? [...MCP_READ_TOOLS, ...(this.actionsEnabled(caller) ? MCP_ACTION_TOOLS : [])].find(
                      (t) => t.name === name,
                  )
                : undefined
        if (!tool) {
            return rpcError(id, JSONRPC.INVALID_PARAMS, `Неизвестный инструмент: ${String(name)}`)
        }
        const rawArgs = params.arguments ?? {}
        if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
            return rpcError(id, JSONRPC.INVALID_PARAMS, 'arguments должен быть объектом')
        }
        const args = rawArgs as Record<string, unknown>
        const started = Date.now()
        const outcome = await this.runTool(caller, tool, args)
        await this.audit.record({
            action: 'ai.toolCall',
            targetType: 'aiToken',
            targetId: caller.token.id,
            workspaceId: caller.access.workspaceId,
            actorId: caller.token.createdById,
            actorEmail: caller.token.creatorEmail,
            metadata: {
                tool: tool.name,
                args: summarizeArgs(args),
                rows: outcome.rows,
                isError: outcome.result.isError,
                ...(outcome.result.isError
                    ? { error: outcome.result.content[0]?.text.slice(0, 200) }
                    : {}),
                tokenName: caller.token.name,
                dataMode: caller.token.dataMode,
                durationMs: Date.now() - started,
            },
        })
        return rpcResult(id, outcome.result)
    }

    private async runTool(
        caller: McpCaller,
        tool: McpTool,
        args: Record<string, unknown>,
    ): Promise<{ result: ToolCallResult; rows: number }> {
        const isAdmin = caller.access.directionIds === null
        if (tool.adminOnly && !isAdmin) {
            return { result: toolError(ADMIN_ONLY_TOOL_MESSAGE), rows: 0 }
        }
        const { confirmation, ...ownArgs } = args
        const parsed = tool.input.safeParse(isActionTool(tool) ? ownArgs : args)
        if (!parsed.success) {
            const issues = parsed.error.issues
                .slice(0, 5)
                .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
                .join('; ')
            return { result: toolError(`Некорректные аргументы — ${issues}`), rows: 0 }
        }
        const ctx: McpToolContext = {
            prisma: this.prisma,
            access: caller.access,
            scope: new McpScope(caller.access),
            people: new McpPeople(
                environment.encryptionKey,
                caller.access.workspaceId,
                caller.token.dataMode,
            ),
            now: new Date(),
            schedule: this.schedule,
            bus: this.bus,
        }
        try {
            if (isActionTool(tool)) {
                const pending = await this.confirmAction(caller, tool, ctx, parsed.data, confirmation)
                if (pending) return { result: pending, rows: 0 }
            }
            const { data, rows } = await tool.run(ctx, parsed.data)
            return {
                result: {
                    content: [{ type: 'text', text: JSON.stringify(data) }],
                    structuredContent: data,
                    isError: false,
                },
                rows,
            }
        } catch (error) {
            if (error instanceof McpToolError || error instanceof DefaultError) {
                return { result: toolError(error.message), rows: 0 }
            }
            this.logger.error(
                `MCP tool ${tool.name} failed`,
                error instanceof Error ? error.stack : String(error),
            )
            return {
                result: toolError('Внутренняя ошибка сервера ClubSpace — попробуйте позже'),
                rows: 0,
            }
        }
    }

    // null = confirmed, go ahead; otherwise the preview / refusal to return.
    private async confirmAction(
        caller: McpCaller,
        tool: McpActionTool,
        ctx: McpToolContext,
        args: Record<string, unknown>,
        confirmation: unknown,
    ): Promise<ToolCallResult | null> {
        const secret = environment.encryptionKey
        if (typeof confirmation === 'string' && confirmation.length > 0) {
            const valid = verifyActionConfirmation(secret, confirmation, {
                tokenId: caller.token.id,
                tool: tool.name,
                args,
                now: ctx.now,
            })
            return valid
                ? null
                : toolError(
                      'Код подтверждения недействителен или устарел — вызовите инструмент без confirmation и снова спросите человека',
                  )
        }
        const preview = await tool.preview(ctx, args)
        const expiresAt = new Date(ctx.now.getTime() + ACTION_CONFIRMATION_TTL_MS)
        const data = {
            requiresConfirmation: true,
            preview,
            confirmation: signActionConfirmation(secret, {
                tokenId: caller.token.id,
                tool: tool.name,
                args,
                expiresAt,
            }),
            expiresAt: expiresAt.toISOString(),
            instruction:
                'Ничего не изменено. Покажите человеку preview и повторите вызов с теми же аргументами и confirmation только после его явного согласия.',
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(data) }],
            structuredContent: data,
            isError: false,
        }
    }
}
