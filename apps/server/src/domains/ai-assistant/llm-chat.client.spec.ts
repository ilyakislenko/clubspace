import { environment } from '../../environments/environment'
import {
    createSseDataParser,
    isLlmConfigured,
    LlmChatClient,
    LlmChatError,
    type LlmStreamEvent,
    ToolCallAccumulator,
} from './llm-chat.client'

const sse = (...payloads: (object | string)[]) =>
    payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('')

const streamResponse = (chunks: string[], status = 200) =>
    new Response(
        new ReadableStream({
            start(controller) {
                for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
                controller.close()
            },
        }),
        { status, headers: { 'Content-Type': 'text/event-stream' } },
    )

const collect = async (gen: AsyncGenerator<LlmStreamEvent>) => {
    const out: LlmStreamEvent[] = []
    for await (const e of gen) out.push(e)
    return out
}

describe('LlmChatClient', () => {
    const saved = { ...environment.ai.chat }
    const fetchMock = jest.fn()
    const client = new LlmChatClient()
    const run = () =>
        collect(client.stream({ messages: [{ role: 'user', content: 'Привет' }], tools: [], maxTokens: 100 }))

    beforeEach(() => {
        Object.assign(environment.ai.chat, { baseUrl: 'https://llm.test/v1/', apiKey: 'k', model: 'm/x' })
        fetchMock.mockReset()
        global.fetch = fetchMock as never
    })
    afterAll(() => {
        Object.assign(environment.ai.chat, saved)
    })

    it('splits SSE data lines across chunks and skips comments', () => {
        const parse = createSseDataParser()
        expect(parse(': OPENROUTER PROCESSING\n\ndata: {"a"')).toEqual([])
        expect(parse(':1}\n\ndata: [DONE]\n')).toEqual(['{"a":1}', '[DONE]'])
    })

    it('stitches tool calls streamed in fragments', () => {
        const acc = new ToolCallAccumulator()
        acc.add([{ index: 1, function: { name: 'b' } }])
        acc.add([{ index: 0, id: 'x', function: { name: 'sched', arguments: '{"a"' } }])
        acc.add([{ index: 0, function: { name: 'ule', arguments: ':1}' } }])
        acc.add([{ index: 2 }])
        expect(acc.result()).toEqual([
            { id: 'x', type: 'function', function: { name: 'schedule', arguments: '{"a":1}' } },
            { id: 'call_1', type: 'function', function: { name: 'b', arguments: '' } },
        ])
    })

    it('streams text, then the tool calls and usage; sends the key, model and tools', async () => {
        fetchMock.mockResolvedValue(
            streamResponse([
                ': keep-alive\n\n',
                sse({ choices: [{ delta: { content: 'При' } }] }).slice(0, 20),
                sse({ choices: [{ delta: { content: 'При' } }] }).slice(20),
                sse(
                    { choices: [{ delta: { content: 'вет' } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'club_overview', arguments: '{}' } }] } }] },
                    'not json',
                    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } },
                    '[DONE]',
                ),
            ]),
        )
        const events = await collect(
            client.stream({
                messages: [{ role: 'user', content: 'Привет' }],
                tools: [{ type: 'function', function: { name: 'club_overview', description: 'd', parameters: {} } }],
                toolChoice: 'none',
                maxTokens: 100,
            }),
        )
        expect(events).toEqual([
            { kind: 'text', text: 'При' },
            { kind: 'text', text: 'вет' },
            {
                kind: 'toolCalls',
                calls: [{ id: 'c1', type: 'function', function: { name: 'club_overview', arguments: '{}' } }],
            },
            { kind: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
        ])
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://llm.test/v1/chat/completions')
        expect(init.headers.Authorization).toBe('Bearer k')
        expect(JSON.parse(init.body)).toMatchObject({
            model: 'm/x',
            stream: true,
            tool_choice: 'none',
            max_tokens: 100,
            stream_options: { include_usage: true },
        })
    })

    it('explains a provider refusal and a broken stream', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'No credits' } }), { status: 402 }),
        )
        await expect(run()).rejects.toThrow('ИИ-сервис ответил ошибкой 402: на счёте ИИ-сервиса закончились средства (No credits)')

        fetchMock.mockResolvedValue(new Response('oops', { status: 401 }))
        await expect(run()).rejects.toThrow('проверьте AI_CHAT_API_KEY')

        fetchMock.mockResolvedValue(new Response('', { status: 429 }))
        await expect(run()).rejects.toThrow('перегружен')

        fetchMock.mockResolvedValue(new Response('', { status: 500 }))
        await expect(run()).rejects.toThrow('попробуйте ещё раз позже')

        fetchMock.mockResolvedValue(streamResponse([sse({ error: { message: 'upstream died' } })]))
        await expect(run()).rejects.toThrow('ИИ-сервис прервал ответ: upstream died')

        fetchMock.mockRejectedValue(new TypeError('fetch failed'))
        await expect(run()).rejects.toThrow('проверьте AI_CHAT_BASE_URL')
    })

    it('refuses without a key and says so', async () => {
        environment.ai.chat.apiKey = undefined
        expect(isLlmConfigured()).toBe(false)
        await expect(run()).rejects.toBeInstanceOf(LlmChatError)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
