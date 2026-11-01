import { createServer, type IncomingMessage, type Server } from 'http'
import type { AddressInfo } from 'net'

// A local OpenAI-compatible chat-completions server for the «ИИ-ассистент»
// chat: streams scripted answers over SSE exactly like OpenRouter does
// (keep-alive comments, tool calls in fragments, usage in the last chunk) and
// keeps every request it received, so a spec can assert on what the model
// would have seen.

export type FakeLlmRequest = {
    authorization: string | undefined
    body: {
        model: string
        stream: boolean
        tool_choice?: string
        tools?: { type: string; function: { name: string } }[]
        messages: {
            role: string
            content: string | null
            tool_calls?: { id: string; function: { name: string; arguments: string } }[]
            tool_call_id?: string
        }[]
    }
}

// What the model "says" to one request: text, a tool call, or an HTTP error.
export type FakeLlmReply =
    | { text: string }
    | { toolCall: { name: string; arguments: Record<string, unknown> } }
    | { status: number; error: string }

export type FakeLlmScript = (req: FakeLlmRequest['body']) => FakeLlmReply

export type FakeLlm = {
    url: string
    requests: FakeLlmRequest[]
    script: FakeLlmScript
    close: () => Promise<void>
}

const USAGE = { prompt_tokens: 1200, completion_tokens: 80 }

const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        let data = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => (data += chunk))
        req.on('end', () => resolve(data))
        req.on('error', reject)
    })

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`

// Splits a string into a few pieces, so the client has to stitch them.
const pieces = (s: string, n = 3): string[] => {
    const size = Math.max(1, Math.ceil(s.length / n))
    const out: string[] = []
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
    return out
}

let callSeq = 0

export const startFakeLlm = async (script: FakeLlmScript, port = 0): Promise<FakeLlm> => {
    const fake: Omit<FakeLlm, 'url' | 'close'> = { requests: [], script }
    const server: Server = createServer(async (req, res) => {
        if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
            res.writeHead(404).end()
            return
        }
        const body = JSON.parse(await readBody(req)) as FakeLlmRequest['body']
        fake.requests.push({ authorization: req.headers.authorization, body })
        const reply = fake.script(body)
        if ('status' in reply) {
            res.writeHead(reply.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: reply.error } }))
            return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write(': OPENROUTER PROCESSING\n\n')
        if ('text' in reply) {
            for (const piece of pieces(reply.text, 4)) {
                res.write(sse({ choices: [{ index: 0, delta: { content: piece } }] }))
            }
            res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
        } else {
            const id = `call_${++callSeq}`
            res.write(
                sse({
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id,
                                        type: 'function',
                                        function: { name: reply.toolCall.name, arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                }),
            )
            for (const piece of pieces(JSON.stringify(reply.toolCall.arguments))) {
                res.write(
                    sse({
                        choices: [
                            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } },
                        ],
                    }),
                )
            }
            res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }))
        }
        res.write(sse({ choices: [], usage: USAGE }))
        res.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    const { port: bound } = server.address() as AddressInfo
    return Object.assign(fake as FakeLlm, {
        url: `http://127.0.0.1:${bound}/v1`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    })
}

// The default script: a question → one tool call (chosen by `pickTool`); the
// tool's answer → a reply that names every person and group it got back, the
// way a model would (pseudonyms as is, groups as [group:id]).
export const toolThenAnswer =
    (pickTool: (question: string) => { name: string; arguments: Record<string, unknown> }): FakeLlmScript =>
    (body) => {
        const last = body.messages[body.messages.length - 1]
        if (last.role === 'user') return { toolCall: pickTool(last.content ?? '') }
        const toolText = body.messages
            .filter((m) => m.role === 'tool')
            .map((m) => m.content ?? '')
            .join('\n')
        const refs = [...new Set(toolText.match(/\b[mc]_[0-9a-f]{10}\b/g) ?? [])]
        const groups = [
            ...new Set(
                [...toolText.matchAll(/"groupId":"([0-9a-f-]{36})"|"groups":\[\{"id":"([0-9a-f-]{36})"/g)].map(
                    (m) => m[1] ?? m[2],
                ),
            ),
        ]
        return {
            text: [
                '**Нашёл:**',
                ...refs.map((r) => `- ${r}`),
                ...groups.map((g) => `- группа [group:${g}]`),
            ].join('\n'),
        }
    }
