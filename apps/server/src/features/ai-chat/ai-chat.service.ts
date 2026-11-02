// The admin's «ИИ-ассистент» chat, server side: the gates (configured,
// owner's consent, monthly limit), one streamed turn — the model, the
// read-only MCP tools run in-process in the asker's scope, the conversation
// and usage saved, the question audited — and the chips: pseudonyms and
// [group:]/[plan:] tokens resolved to names, within the asker's current scope,
// only for the browser.
import { Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'

import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import { AI_CHAT_DATA_WARNING } from '../../domains/ai-assistant/ai-chat-warning'
import {
    isLlmConfigured,
    LlmChatClient,
    LlmChatError,
    type LlmMessage,
    type LlmToolDefinition,
} from '../../domains/ai-assistant/llm-chat.client'
import { pseudonymFor } from '../../domains/ai-assistant/pseudonym'
import { AuditService } from '../../domains/audit/services/audit.service'
import { trialCapsApply } from '../../domains/billing/trial-limits'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    QuotaExceededError,
} from '../../shared/errors/shared.errors'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import { localDateInTz, wallClockToUtc } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import { McpPeople } from '../mcp/mcp-people'
import { McpScope } from '../mcp/mcp-scope'
import { toolInputJsonSchema } from '../mcp/mcp-tool'
import { buildToolContext, runReadTool, toolError, visibleReadTools } from '../mcp/mcp-tool-exec'
import {
    buildModelMessages,
    buildSystemPrompt,
    conversationTitle,
    type EntityTokens,
    extractEntityTokens,
    type KnownPerson,
    MAX_ANSWER_TOKENS,
    MAX_QUESTIONS_PER_CONVERSATION,
    MAX_TOOL_ROUNDS,
    monthBounds,
    parseStoredMessages,
    parseStoredRefs,
    pseudonymizeQuestion,
    type StoredChatMessage,
    type StoredRefs,
    SUGGESTED_QUESTIONS,
    toolLabel,
} from './ai-chat-utils'
import type {
    AiChatEmit,
    AiChatEntity,
    AiChatStateResponse,
    AskAiChatFeatureResponse,
} from './ai-chat.feature'

export const AI_CHAT_NOT_CONFIGURED_MESSAGE =
    'ИИ-ассистент не настроен: администратор платформы должен задать AI_CHAT_API_KEY'
export const AI_CHAT_CONSENT_MESSAGE =
    'Владелец клуба ещё не включил ИИ-ассистента — он принимает условия передачи данных на этой странице'
export const AI_CHAT_OWNER_ONLY_MESSAGE = 'Включить ИИ-ассистента может только владелец клуба'

type Limit = AiChatStateResponse['limit']

const STOPPED_MESSAGE = 'Ответ остановлен'
const FAILED_MESSAGE = 'Не удалось получить ответ — попробуйте ещё раз'

@Injectable()
export class AiChatService {
    private readonly logger = new Logger(AiChatService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly llm: LlmChatClient,
        private readonly bus: FeaturesBus,
        private readonly schedule: GetWorkspaceScheduleHandler,
    ) {}

    // ---- gates ----

    private consentRow(workspaceId: string) {
        return this.prisma.aiDataTransferAcceptance.findFirst({
            where: { workspaceId, warningVersion: AI_CHAT_DATA_WARNING.version },
            orderBy: { acceptedAt: 'desc' },
            select: { acceptedAt: true },
        })
    }

    // Questions asked this calendar month (club time) against the allowance —
    // the smaller one while the club is on its unpaid trial.
    async limit(access: AiAccess, now: Date): Promise<Limit> {
        const { from, to } = monthBounds(localDateInTz(now, access.timezone))
        const [used, billing] = await Promise.all([
            this.prisma.aiChatUsage.count({
                where: {
                    workspaceId: access.workspaceId,
                    createdAt: {
                        gte: wallClockToUtc(`${from}T00:00:00`, access.timezone),
                        lt: wallClockToUtc(`${to}T00:00:00`, access.timezone),
                    },
                },
            }),
            this.prisma.workspaceBilling.findUnique({
                where: { workspaceId: access.workspaceId },
                select: { status: true, currentPeriodEnd: true },
            }),
        ])
        const { monthlyQuestions, trialMonthlyQuestions } = environment.ai.chat
        const perMonth = trialCapsApply(billing, now, environment.billing.enabled)
            ? trialMonthlyQuestions
            : monthlyQuestions
        return { perMonth, used, remaining: Math.max(0, perMonth - used) }
    }

    async state(access: AiAccess): Promise<AiChatStateResponse> {
        const [consent, limit] = await Promise.all([
            this.consentRow(access.workspaceId),
            this.limit(access, new Date()),
        ])
        const configured = isLlmConfigured()
        return {
            configured,
            model: configured ? this.llm.model : null,
            scope: access.directionIds === null ? 'club' : 'directions',
            consent: {
                accepted: consent !== null,
                acceptedAt: consent?.acceptedAt.toISOString() ?? null,
                canAccept: access.isOwner,
                warning: { ...AI_CHAT_DATA_WARNING },
            },
            limit,
            suggestions: [...SUGGESTED_QUESTIONS],
        }
    }

    async acceptWarning(
        access: AiAccess,
        p: { warningVersion: string; ip: string | null; userAgent: string | null },
    ): Promise<void> {
        if (!access.isOwner) throw new ForbiddenError({ message: AI_CHAT_OWNER_ONLY_MESSAGE })
        if (p.warningVersion !== AI_CHAT_DATA_WARNING.version) {
            throw new ConflictError({
                message: 'Текст условий обновился. Откройте его заново и примите текущую редакцию.',
            })
        }
        // A double tap: already accepted, nothing more to record.
        if (await this.consentRow(access.workspaceId)) return
        const owner = await this.prisma.user.findUniqueOrThrow({
            where: { id: access.userId },
            select: { firstname: true, lastname: true, email: true },
        })
        await this.prisma.aiDataTransferAcceptance.create({
            data: {
                workspaceId: access.workspaceId,
                userId: access.userId,
                userEmail: owner.email,
                userName: displayName(owner).slice(0, 255),
                warningVersion: AI_CHAT_DATA_WARNING.version,
                ip: p.ip?.slice(0, 64) ?? null,
                userAgent: p.userAgent?.slice(0, 512) ?? null,
            },
        })
        await this.audit.record({
            action: 'ai.chatEnable',
            targetType: 'aiChat',
            targetId: null,
            workspaceId: access.workspaceId,
            actorId: access.userId,
            actorEmail: owner.email,
            metadata: { warningVersion: AI_CHAT_DATA_WARNING.version },
        })
    }

    // ---- chips ----

    // Tokens of an answer → names and ids, only what the asker may see NOW
    // (a pseudonym from an old answer of a student who left their directions
    // stays a bare pseudonym).
    async resolveEntities(
        access: AiAccess,
        refs: StoredRefs,
        tokens: EntityTokens,
    ): Promise<AiChatEntity[]> {
        const scope = new McpScope(access)
        const idsOf = (kind: 'member' | 'staff') =>
            [...tokens.refs].flatMap((r) => (refs[r]?.kind === kind ? [refs[r].userId] : []))
        const memberIds = idsOf('member')
        const staffIds = idsOf('staff')
        const [members, staff, groups, plans] = await Promise.all([
            memberIds.length > 0
                ? this.prisma.workspaceMember.findMany({
                      where: { AND: [scope.students(), { userId: { in: memberIds } }] },
                      select: { user: { select: { id: true, firstname: true, lastname: true, email: true } } },
                  })
                : [],
            staffIds.length > 0
                ? this.prisma.user.findMany({
                      where: {
                          id: { in: staffIds },
                          OR: [
                              { id: access.ownerId },
                              {
                                  workspaceMemberships: {
                                      some: {
                                          workspaceId: access.workspaceId,
                                          role: { name: { in: [...STAFF_ROLES] } },
                                      },
                                  },
                              },
                          ],
                      },
                      select: { id: true, firstname: true, lastname: true, email: true },
                  })
                : [],
            tokens.groups.size > 0
                ? this.prisma.group.findMany({
                      where: { AND: [scope.groups(), { id: { in: [...tokens.groups] } }] },
                      select: { id: true, name: true },
                  })
                : [],
            tokens.plans.size > 0
                ? this.prisma.plan.findMany({
                      where: { AND: [scope.plans(), { id: { in: [...tokens.plans] } }] },
                      select: { id: true, name: true },
                  })
                : [],
        ])
        const people = new Map<string, string>([
            ...members.map((m) => [m.user.id, displayName(m.user)] as const),
            ...staff.map((u) => [u.id, displayName(u)] as const),
        ])
        const out: AiChatEntity[] = []
        for (const token of tokens.refs) {
            const person = refs[token]
            const label = person ? people.get(person.userId) : undefined
            if (person && label) out.push({ token, type: person.kind, id: person.userId, label })
        }
        for (const g of groups) out.push({ token: `[group:${g.id}]`, type: 'group', id: g.id, label: g.name })
        for (const p of plans) out.push({ token: `[plan:${p.id}]`, type: 'plan', id: p.id, label: p.name })
        return out
    }

    // Everyone in the club with a pseudonym, for taking full names out of a
    // question. Out-of-scope people get a pseudonym too: the tools then refuse
    // it, and the model never learns who it was.
    private async knownPeople(access: AiAccess): Promise<KnownPerson[]> {
        const [members, owner] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where: { workspaceId: access.workspaceId },
                select: {
                    userId: true,
                    role: { select: { name: true } },
                    user: { select: { firstname: true, lastname: true } },
                },
            }),
            this.prisma.user.findUnique({
                where: { id: access.ownerId },
                select: { id: true, firstname: true, lastname: true },
            }),
        ])
        const person = (
            userId: string,
            kind: KnownPerson['kind'],
            u: { firstname: string | null; lastname: string | null },
        ): KnownPerson => ({
            ref: pseudonymFor(environment.encryptionKey, access.workspaceId, userId, kind),
            kind,
            userId,
            firstname: u.firstname,
            lastname: u.lastname,
        })
        const staffRoles: readonly string[] = STAFF_ROLES
        return [
            ...members
                .filter((m) => m.userId !== access.ownerId)
                .map((m) =>
                    person(m.userId, staffRoles.includes(m.role.name) ? 'staff' : 'member', m.user),
                ),
            ...(owner ? [person(owner.id, 'staff', owner)] : []),
        ]
    }

    // ---- one turn ----

    async prepareTurn(
        access: AiAccess,
        p: { conversationId: string; question: string },
    ): Promise<AskAiChatFeatureResponse> {
        if (!isLlmConfigured()) throw new BadRequestError({ message: AI_CHAT_NOT_CONFIGURED_MESSAGE })
        if (!(await this.consentRow(access.workspaceId))) {
            throw new ForbiddenError({ message: AI_CHAT_CONSENT_MESSAGE })
        }
        const now = new Date()
        const limit = await this.limit(access, now)
        if (limit.remaining <= 0) {
            throw new QuotaExceededError({
                message: `Лимит ИИ-ассистента на этот месяц исчерпан: ${limit.perMonth} вопросов. Он обновится 1-го числа.`,
                metadata: { perMonth: limit.perMonth },
            })
        }
        const existing = await this.prisma.aiChatConversation.findUnique({
            where: { id: p.conversationId },
        })
        if (existing && (existing.workspaceId !== access.workspaceId || existing.userId !== access.userId)) {
            throw new NotFoundError({ message: 'Диалог не найден' })
        }
        const history = existing ? parseStoredMessages(existing.messages) : []
        if (history.filter((m) => m.role === 'user').length >= MAX_QUESTIONS_PER_CONVERSATION) {
            throw new BadRequestError({
                message: `В этом диалоге уже ${MAX_QUESTIONS_PER_CONVERSATION} вопросов — начните новый`,
            })
        }
        const turn = {
            access,
            conversationId: p.conversationId,
            question: p.question,
            history,
            refs: existing ? parseStoredRefs(existing.refs) : {},
            title: existing?.title ?? null,
            limit,
            now,
        }
        return { run: (emit, signal) => this.runTurn(turn, emit, signal) }
    }

    private async runTurn(
        t: {
            access: AiAccess
            conversationId: string
            question: string
            history: StoredChatMessage[]
            refs: StoredRefs
            title: string | null
            limit: Limit
            now: Date
        },
        emit: AiChatEmit,
        signal: AbortSignal,
    ): Promise<void> {
        const { access } = t
        const started = Date.now()
        const refs: StoredRefs = { ...t.refs }

        const { content, matched } = pseudonymizeQuestion(t.question, await this.knownPeople(access))
        for (const m of matched) refs[m.ref] = { kind: m.kind, userId: m.userId }
        const userMessage: StoredChatMessage = {
            role: 'user',
            content,
            text: t.question,
            at: t.now.toISOString(),
        }
        const title = t.title ?? conversationTitle(t.question)
        // The conversation and the counted question exist before the first
        // token: the list shows it at once, and a crash still counts.
        if (t.title === null) {
            await this.prisma.aiChatConversation.create({
                data: {
                    id: t.conversationId,
                    workspaceId: access.workspaceId,
                    userId: access.userId,
                    title,
                    messages: [...t.history, userMessage],
                    refs,
                },
            })
        }
        const usageRow = await this.prisma.aiChatUsage.create({
            data: {
                workspaceId: access.workspaceId,
                userId: access.userId,
                conversationId: t.conversationId,
                model: this.llm.model.slice(0, 128),
            },
            select: { id: true },
        })
        emit({ event: 'start', data: { conversationId: t.conversationId, title } })

        const tools = visibleReadTools(access)
        const definitions: LlmToolDefinition[] = tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: toolInputJsonSchema(tool.input),
            },
        }))
        const roundRefs = new Set<string>()
        const ctx = buildToolContext(
            { prisma: this.prisma, schedule: this.schedule, bus: this.bus },
            access,
            new McpPeople(environment.encryptionKey, access.workspaceId, 'PSEUDONYMIZED', (ref, person) => {
                refs[ref] = person
                roundRefs.add(ref)
            }),
            t.now,
        )
        const system = buildSystemPrompt(
            access,
            localDateInTz(t.now, access.timezone),
            await loadClubVocabulary(this.prisma, access.workspaceId),
        )
        const messages: LlmMessage[] = buildModelMessages(system, [...t.history, userMessage])
        const added: StoredChatMessage[] = [userMessage]
        const usage = { inputTokens: 0, outputTokens: 0 }
        const toolNames: string[] = []
        let toolErrors = 0
        let rows = 0
        let status: 'ok' | 'error' | 'aborted' = 'ok'
        let text = ''

        try {
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                text = ''
                let calls: { id: string; name: string; arguments: string }[] = []
                for await (const ev of this.llm.stream({
                    messages,
                    tools: definitions,
                    toolChoice: round === MAX_TOOL_ROUNDS - 1 ? 'none' : 'auto',
                    maxTokens: MAX_ANSWER_TOKENS,
                    signal,
                })) {
                    if (ev.kind === 'text') {
                        text += ev.text
                        emit({ event: 'text', data: { text: ev.text } })
                    } else if (ev.kind === 'toolCalls') {
                        calls = ev.calls.map((c) => ({
                            id: c.id,
                            name: c.function.name,
                            arguments: c.function.arguments,
                        }))
                    } else {
                        usage.inputTokens += ev.usage.inputTokens
                        usage.outputTokens += ev.usage.outputTokens
                    }
                }
                if (calls.length === 0 || round === MAX_TOOL_ROUNDS - 1) {
                    added.push({ role: 'assistant', content: text })
                    text = ''
                    break
                }

                messages.push({
                    role: 'assistant',
                    content: text || null,
                    tool_calls: calls.map((c) => ({
                        id: c.id,
                        type: 'function',
                        function: { name: c.name, arguments: c.arguments },
                    })),
                })
                const results: StoredChatMessage[] = []
                roundRefs.clear()
                for (const call of calls) {
                    emit({
                        event: 'tool',
                        data: { id: call.id, tool: call.name, label: toolLabel(call.name), status: 'running' },
                    })
                    const tool = tools.find((x) => x.name === call.name)
                    let args: unknown = {}
                    try {
                        args = call.arguments.trim() ? JSON.parse(call.arguments) : {}
                    } catch {
                        args = null
                    }
                    const outcome = !tool
                        ? { result: toolError(`Неизвестный инструмент: ${call.name}`), rows: 0 }
                        : typeof args !== 'object' || args === null || Array.isArray(args)
                          ? { result: toolError('Аргументы должны быть JSON-объектом'), rows: 0 }
                          : await runReadTool(ctx, tool, args as Record<string, unknown>, this.logger)
                    const isError = outcome.result.isError
                    toolNames.push(call.name)
                    rows += outcome.rows
                    if (isError) toolErrors++
                    const resultText = outcome.result.content[0]?.text ?? ''
                    results.push({
                        role: 'tool',
                        toolCallId: call.id,
                        name: call.name,
                        content: resultText,
                        isError,
                    })
                    messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
                    emit({
                        event: 'tool',
                        data: {
                            id: call.id,
                            tool: call.name,
                            label: toolLabel(call.name),
                            status: isError ? 'error' : 'done',
                        },
                    })
                }
                added.push({ role: 'assistant', content: text, toolCalls: calls }, ...results)
                text = ''
                // Names for the people this round brought in, before the
                // answer that mentions them starts streaming.
                if (roundRefs.size > 0) {
                    const entities = await this.resolveEntities(access, refs, {
                        refs: new Set(roundRefs),
                        groups: new Set(),
                        plans: new Set(),
                    })
                    if (entities.length > 0) emit({ event: 'entities', data: { entities } })
                }
            }
        } catch (error) {
            let message = FAILED_MESSAGE
            if (signal.aborted) {
                status = 'aborted'
                message = STOPPED_MESSAGE
            } else {
                status = 'error'
                if (error instanceof LlmChatError) message = error.message
                else {
                    this.logger.error(
                        'ИИ-ассистент: turn failed',
                        error instanceof Error ? error.stack : String(error),
                    )
                }
                emit({ event: 'error', data: { message } })
            }
            added.push({ role: 'assistant', content: text, error: message })
        }

        const answers = added.flatMap((m) => (m.role === 'assistant' && m.content ? [m.content] : []))
        if (status === 'ok') {
            const entities = await this.resolveEntities(access, refs, extractEntityTokens(answers))
            if (entities.length > 0) emit({ event: 'entities', data: { entities } })
        }

        await this.prisma.aiChatConversation.update({
            where: { id: t.conversationId },
            data: { messages: [...t.history, ...added], refs },
        })
        await this.prisma.aiChatUsage.update({
            where: { id: usageRow.id },
            data: { ...usage, toolCalls: toolNames.length, status },
        })
        await this.audit.record({
            action: 'ai.chatQuestion',
            targetType: 'aiChat',
            targetId: t.conversationId,
            workspaceId: access.workspaceId,
            actorId: access.userId,
            metadata: {
                // What left the server: the question already pseudonymized.
                question: content.slice(0, 200),
                tools: toolNames,
                toolErrors,
                rows,
                model: this.llm.model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                status,
                durationMs: Date.now() - started,
            },
        })
        if (status === 'ok') {
            emit({
                event: 'done',
                data: {
                    usage,
                    limit: {
                        perMonth: t.limit.perMonth,
                        used: t.limit.used + 1,
                        remaining: Math.max(0, t.limit.remaining - 1),
                    },
                },
            })
        }
    }
}
