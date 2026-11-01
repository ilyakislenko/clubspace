// The shape of an ИИ-ассистент tool and the limits every tool shares.
import type { FeaturesBus } from '@shelfjs/features'
import { z } from 'zod'

import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import type { PrismaService } from '../../infrastructure/prisma'
import type { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import type { McpPeople } from './mcp-people'
import type { McpScope } from './mcp-scope'

export type McpToolContext = {
    prisma: PrismaService
    access: AiAccess
    scope: McpScope
    people: McpPeople
    now: Date
    schedule: GetWorkspaceScheduleHandler
    bus: FeaturesBus
}

// `data` goes to the assistant; `rows` is what the audit records.
export type McpToolOutput = { data: Record<string, unknown>; rows: number }

export type McpTool = {
    name: string
    title: string
    // Russian: what the tool answers, when to call it, what the fields mean.
    description: string
    input: z.ZodObject
    // Money and receivables: admin scope only, like the dashboard's revenue.
    adminOnly?: boolean
    // 'action' tools change data and go through confirmation (mcp-actions.ts).
    kind?: 'read' | 'action'
    run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<McpToolOutput>
}

// Typed authoring, erased to McpTool for the registry.
export const defineTool = <S extends z.ZodObject>(tool: {
    name: string
    title: string
    description: string
    input: S
    adminOnly?: boolean
    run: (ctx: McpToolContext, args: z.infer<S>) => Promise<McpToolOutput>
}): McpTool => tool as unknown as McpTool

// A refusal the assistant should read and act on (wrong id, out of scope,
// money for a direction manager): returned as an `isError` tool result, not a
// protocol error, so the model can correct itself.
export class McpToolError extends Error {}

export const ADMIN_ONLY_TOOL_MESSAGE =
    'Финансовые данные доступны только токену администратора клуба'

export const MAX_PAGE_SIZE = 50
export const DEFAULT_PAGE_SIZE = 20

export const pageInput = {
    offset: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .default(0)
        .describe('Сколько записей пропустить — для следующей страницы передайте nextOffset из ответа'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_SIZE)
        .default(DEFAULT_PAGE_SIZE)
        .describe(`Сколько записей вернуть (1–${MAX_PAGE_SIZE})`),
}

export const paginate = <T>(
    rows: readonly T[],
    offset: number,
    limit: number,
): { items: T[]; total: number; nextOffset: number | null } => ({
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
})

// A tool answer never exceeds this many characters of JSON: an assistant's
// context is finite and a runaway list would crowd out the conversation.
export const MAX_RESULT_CHARS = 60_000

// Drops trailing `items` until the answer fits, and says so.
export const capResult = (
    data: Record<string, unknown>,
    maxChars = MAX_RESULT_CHARS,
): Record<string, unknown> => {
    if (JSON.stringify(data).length <= maxChars) return data
    const items = data.items
    if (!Array.isArray(items)) {
        return {
            truncated: true,
            note: 'Ответ слишком большой — сузьте запрос фильтрами или периодом',
        }
    }
    const kept = [...items]
    const note = (count: number) =>
        `Показаны первые ${count} записей — запросите следующие через offset или уменьшите limit`
    // Sized with the longest note it can end up with, so the final one fits.
    const capped: Record<string, unknown> = {
        ...data,
        items: kept,
        truncated: true,
        note: note(items.length),
    }
    while (kept.length > 0 && JSON.stringify(capped).length > maxChars) {
        kept.pop()
    }
    capped.note = note(kept.length)
    return capped
}

// JSON Schema of a tool's arguments for tools/list (input side: defaults make
// fields optional).
export const toolInputJsonSchema = (schema: z.ZodObject): Record<string, unknown> => {
    const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
        io: 'input',
    }) as Record<string, unknown>
    return json
}

// What the audit keeps of the arguments: short scalars, no free-form essays.
export const summarizeArgs = (
    args: Record<string, unknown>,
): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args).slice(0, 20)) {
        if (typeof value === 'string') out[key] = value.slice(0, 80)
        else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
            out[key] = value
        } else if (Array.isArray(value)) out[key] = `[${value.length}]`
        else out[key] = typeof value
    }
    return out
}
