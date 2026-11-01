// The «ИИ-ассистент» chat's model: any OpenAI-compatible chat-completions API
// (OpenRouter by default, environment.ai.chat), streamed over SSE with plain
// fetch. Yields text deltas as they arrive and, when the stream ends, the tool
// calls the model asked for and the token usage. Reads its config on every call
// so a key set at runtime (or a fake server in the e2e suite) takes effect.
import { Injectable } from '@nestjs/common'

import { environment } from '../../environments/environment'

export type LlmToolCall = {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
}

export type LlmMessage =
    | { role: 'system' | 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }

export type LlmToolDefinition = {
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type LlmUsage = { inputTokens: number; outputTokens: number }

export type LlmStreamEvent =
    | { kind: 'text'; text: string }
    | { kind: 'toolCalls'; calls: LlmToolCall[] }
    | { kind: 'usage'; usage: LlmUsage }

// The provider refused or broke the stream. `message` is safe to show.
export class LlmChatError extends Error {
    constructor(
        message: string,
        readonly status: number | null = null,
    ) {
        super(message)
    }
}

const REQUEST_TIMEOUT_MS = 120_000

export const isLlmConfigured = (): boolean => Boolean(environment.ai.chat.apiKey)

// Splits an SSE byte stream into the payloads of its `data:` fields. Comment
// lines (OpenRouter's «: OPENROUTER PROCESSING» keep-alives), event names and
// blank separators are dropped; a payload split across chunks is buffered.
export const createSseDataParser = () => {
    let buffer = ''
    return (chunk: string): string[] => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        const out: string[] = []
        for (const line of lines) {
            if (!line.startsWith('data:')) continue
            out.push(line.slice(5).trimStart())
        }
        return out
    }
}

type ChunkToolCall = {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
}

type CompletionChunk = {
    error?: { message?: string; code?: number | string }
    choices?: { delta?: { content?: string | null; tool_calls?: ChunkToolCall[] } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

// Accumulates streamed tool-call fragments by index: the id and name arrive
// first, the JSON arguments in pieces.
export class ToolCallAccumulator {
    private readonly calls = new Map<number, LlmToolCall>()

    add(fragments: ChunkToolCall[]): void {
        for (const f of fragments) {
            const index = f.index ?? 0
            const call =
                this.calls.get(index) ??
                ({ id: '', type: 'function', function: { name: '', arguments: '' } } as LlmToolCall)
            if (f.id) call.id = f.id
            if (f.function?.name) call.function.name += f.function.name
            if (f.function?.arguments) call.function.arguments += f.function.arguments
            this.calls.set(index, call)
        }
    }

    result(): LlmToolCall[] {
        return [...this.calls.entries()]
            .sort(([a], [b]) => a - b)
            .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
            .filter((call) => call.function.name.length > 0)
    }
}

const providerMessage = (status: number, body: string): string => {
    let detail = ''
    try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        detail = parsed.error?.message ?? ''
    } catch {
        detail = ''
    }
    const hint =
        status === 401 || status === 403
            ? 'проверьте AI_CHAT_API_KEY'
            : status === 402
              ? 'на счёте ИИ-сервиса закончились средства'
              : status === 429
                ? 'ИИ-сервис перегружен, попробуйте через минуту'
                : 'попробуйте ещё раз позже'
    return `ИИ-сервис ответил ошибкой ${status}: ${hint}${detail ? ` (${detail.slice(0, 160)})` : ''}`
}

@Injectable()
export class LlmChatClient {
    get model(): string {
        return environment.ai.chat.model
    }

    async *stream(p: {
        messages: LlmMessage[]
        tools: LlmToolDefinition[]
        maxTokens: number
        // 'none' on the last round: the tools stay declared (a history with
        // tool calls needs them on some providers) but the model must answer.
        toolChoice?: 'auto' | 'none'
        signal?: AbortSignal
    }): AsyncGenerator<LlmStreamEvent> {
        const { baseUrl, apiKey, model } = environment.ai.chat
        if (!apiKey) throw new LlmChatError('ИИ-ассистент не настроен: не задан AI_CHAT_API_KEY')

        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const signal = p.signal ? AbortSignal.any([p.signal, timeout]) : timeout
        let response: Response
        try {
            response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    // OpenRouter's app attribution; other providers ignore them.
                    'HTTP-Referer': environment.rootUrl,
                    'X-Title': 'ClubSpace',
                },
                body: JSON.stringify({
                    model,
                    messages: p.messages,
                    ...(p.tools.length > 0
                        ? { tools: p.tools, tool_choice: p.toolChoice ?? 'auto' }
                        : {}),
                    stream: true,
                    stream_options: { include_usage: true },
                    max_tokens: p.maxTokens,
                    temperature: 0.2,
                }),
                signal,
            })
        } catch (error) {
            if (p.signal?.aborted) throw error
            throw new LlmChatError(
                timeout.aborted
                    ? 'ИИ-сервис не ответил вовремя — попробуйте ещё раз'
                    : 'Не удалось связаться с ИИ-сервисом — проверьте AI_CHAT_BASE_URL',
            )
        }
        if (!response.ok || !response.body) {
            const body = await response.text().catch(() => '')
            throw new LlmChatError(providerMessage(response.status, body), response.status)
        }

        const parse = createSseDataParser()
        const decoder = new TextDecoder()
        const toolCalls = new ToolCallAccumulator()
        let usage: LlmUsage | null = null
        const reader = response.body.getReader()
        try {
            let done = false
            while (!done) {
                const read = await reader.read()
                if (read.done) break
                for (const data of parse(decoder.decode(read.value, { stream: true }))) {
                    if (data === '[DONE]') {
                        done = true
                        break
                    }
                    let chunk: CompletionChunk
                    try {
                        chunk = JSON.parse(data) as CompletionChunk
                    } catch {
                        continue
                    }
                    if (chunk.error) {
                        throw new LlmChatError(
                            `ИИ-сервис прервал ответ: ${String(chunk.error.message ?? 'ошибка').slice(0, 200)}`,
                        )
                    }
                    if (chunk.usage) {
                        usage = {
                            inputTokens: chunk.usage.prompt_tokens ?? 0,
                            outputTokens: chunk.usage.completion_tokens ?? 0,
                        }
                    }
                    const delta = chunk.choices?.[0]?.delta
                    if (delta?.content) yield { kind: 'text', text: delta.content }
                    if (delta?.tool_calls) toolCalls.add(delta.tool_calls)
                }
            }
        } finally {
            await reader.cancel().catch(() => undefined)
        }

        const calls = toolCalls.result()
        if (calls.length > 0) yield { kind: 'toolCalls', calls }
        if (usage) yield { kind: 'usage', usage }
    }
}
