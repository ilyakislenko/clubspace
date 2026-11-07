import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { spawn } from 'child_process'

import {
    llmConfigFrom,
    LlmUnavailableError,
    requestChat,
    reviewTitles,
    runTool,
    scanSpeechChapters,
    speechConfigFrom,
} from './speech'

jest.mock('child_process', () => ({ spawn: jest.fn() }))

const spawnMock = spawn as unknown as jest.Mock

type FakeChild = EventEmitter & { stderr: EventEmitter; kill: jest.Mock }

const makeChild = (): FakeChild =>
    Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: jest.fn() })

// Every spawn gets a child that plays `script` on the next tick.
const onSpawn = (
    script: (child: FakeChild, binary: string, args: string[]) => void | Promise<void>,
) =>
    spawnMock.mockImplementation((binary: string, args: string[]) => {
        const child = makeChild()
        setImmediate(() => void script(child, binary, args))
        return child
    })

const LLM = { baseUrl: 'https://openrouter.ai/api/v1/', model: 'openai/gpt-4.1-mini' }

const chatResponse = (content: unknown, status = 200) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })

let dir: string

beforeEach(async () => {
    spawnMock.mockReset()
    dir = await fs.mkdtemp(join(tmpdir(), 'speech-spec-'))
})

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
})

describe('speechConfigFrom', () => {
    const env = {
        whisperCliPath: 'whisper-cli',
        whisperModelPath: '/models/ggml-small.bin',
        chaptersLlm: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b-instruct' },
    }

    it('turns the step on with a Whisper model and a chat endpoint', () => {
        expect(speechConfigFrom(env)).toEqual({
            config: {
                whisperCliPath: 'whisper-cli',
                whisperModelPath: '/models/ggml-small.bin',
                llm: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b-instruct' },
            },
        })
        expect(
            speechConfigFrom({ ...env, chaptersLlm: { ...LLM, apiKey: 'sk-or-1' } }),
        ).toMatchObject({ config: { llm: { ...LLM, apiKey: 'sk-or-1' } } })
    })

    it('says why the step is off', () => {
        expect(speechConfigFrom({ ...env, whisperModelPath: undefined })).toEqual({
            disabled: 'WHISPER_MODEL_PATH is not set',
        })
        expect(speechConfigFrom({ ...env, chaptersLlm: { model: 'm' } })).toEqual({
            disabled: 'CHAPTERS_LLM_BASE_URL or CHAPTERS_LLM_MODEL is not set',
        })
        expect(speechConfigFrom({ ...env, chaptersLlm: { baseUrl: 'http://x/v1' } })).toEqual({
            disabled: 'CHAPTERS_LLM_BASE_URL or CHAPTERS_LLM_MODEL is not set',
        })
    })
})

describe('llmConfigFrom', () => {
    it('needs both the URL and the model; the key is optional', () => {
        expect(llmConfigFrom({ ...LLM, apiKey: 'sk-or-1' })).toEqual({ ...LLM, apiKey: 'sk-or-1' })
        expect(llmConfigFrom(LLM)).toEqual(LLM)
        expect(llmConfigFrom({ model: 'm' })).toBeNull()
        expect(llmConfigFrom({ baseUrl: 'http://x/v1' })).toBeNull()
    })
})

describe('reviewTitles', () => {
    it('asks the model about the OCR titles and keeps those it does not reject', async () => {
        const fetchImpl = jest.fn(async () => chatResponse('{"reject":[2]}'))
        const chapters = [
            { positionSec: 10, title: 'Octopus Guard Entry' },
            { positionSec: 62, title: 'CLUB CLUE' },
        ]
        await expect(
            reviewTitles(
                LLM,
                { videoTitle: 'Octopus 2.0 · Vol 3 · часть 6', courses: [] },
                chapters,
                fetchImpl as never,
            ),
        ).resolves.toEqual([chapters[0]])
        const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
        expect(body.messages[1].content).toContain('2. [01:02] CLUB CLUE')
    })
})

describe('runTool', () => {
    const options = { label: 'whisper-cli', timeoutMs: 1000 }

    it('resolves when the tool exits cleanly', async () => {
        onSpawn((child) => void child.emit('close', 0))
        await expect(runTool('whisper-cli', ['-h'], options)).resolves.toBeUndefined()
        expect(spawnMock).toHaveBeenCalledWith('whisper-cli', ['-h'], {
            stdio: ['ignore', 'ignore', 'pipe'],
        })
    })

    it('fails with the tool’s message, or its exit code when it said nothing', async () => {
        onSpawn((child) => {
            child.stderr.emit('data', Buffer.from('error: failed to open model\n'))
            child.emit('close', 3)
        })
        await expect(runTool('whisper-cli', [], options)).rejects.toThrow(
            'error: failed to open model',
        )
        onSpawn((child) => void child.emit('close', 3))
        await expect(runTool('whisper-cli', [], options)).rejects.toThrow(
            'whisper-cli exited with code 3',
        )
    })

    it('surfaces a missing binary', async () => {
        onSpawn((child) => void child.emit('error', new Error('spawn whisper-cli ENOENT')))
        await expect(runTool('whisper-cli', [], options)).rejects.toThrow('ENOENT')
    })

    it('kills a hung tool after the timeout', async () => {
        jest.useFakeTimers()
        try {
            const child = makeChild()
            spawnMock.mockReturnValue(child)
            const pending = runTool('whisper-cli', [], options)
            jest.advanceTimersByTime(1000)
            expect(child.kill).toHaveBeenCalledWith('SIGKILL')
            child.emit('close', null)
            await expect(pending).rejects.toThrow('whisper-cli exceeded 1000ms and was killed')
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('requestChat', () => {
    const messages = [{ role: 'user' as const, content: 'transcript' }]

    it('posts a JSON-mode chat request and returns the answer text', async () => {
        const fetchImpl = jest.fn(async () => chatResponse('{"chapters":[]}'))
        await expect(
            requestChat({ ...LLM, apiKey: 'sk-or-1' }, messages, fetchImpl as never),
        ).resolves.toBe('{"chapters":[]}')

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
        expect(init.method).toBe('POST')
        expect(init.headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-or-1',
        })
        expect(JSON.parse(init.body as string)).toEqual({
            model: 'openai/gpt-4.1-mini',
            messages,
            temperature: 0,
            response_format: { type: 'json_object' },
        })
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('sends no key to a local server', async () => {
        const fetchImpl = jest.fn(async () => chatResponse('{}'))
        await requestChat(LLM, messages, fetchImpl as never)
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    })

    it('reports a refusal (HTTP 402 and the like) as the model being unavailable', async () => {
        const fetchImpl = jest.fn(
            async () => new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 }),
        )
        const failure = requestChat(LLM, messages, fetchImpl as never)
        await expect(failure).rejects.toThrow(
            'chapters LLM answered HTTP 402: {"error":{"message":"Insufficient credits"}}',
        )
        await expect(failure).rejects.toBeInstanceOf(LlmUnavailableError)
    })

    it('reports an unreachable or timed-out endpoint as the model being unavailable', async () => {
        for (const reason of [new TypeError('fetch failed'), 'aborted']) {
            const fetchImpl = jest.fn(async () => {
                throw reason
            })
            const failure = requestChat(LLM, messages, fetchImpl as never)
            await expect(failure).rejects.toBeInstanceOf(LlmUnavailableError)
            await expect(failure).rejects.toThrow('chapters LLM unreachable: ')
        }
    })

    it('fails on an answer without message text', async () => {
        const fetchImpl = jest.fn(async () => new Response('{"choices":[]}'))
        await expect(requestChat(LLM, messages, fetchImpl as never)).rejects.toThrow(
            'chapters LLM answer has no message text',
        )
    })
})

describe('scanSpeechChapters', () => {
    const SPEECH = {
        whisperCliPath: '/opt/whisper-cli',
        whisperModelPath: '/models/ggml-small.bin',
        llm: LLM,
    }

    // Twenty segments of a lesson, 15 s apart.
    const WHISPER_JSON = JSON.stringify({
        result: { language: 'en' },
        transcription: Array.from({ length: 20 }, (_, idx) => ({
            offsets: { from: idx * 15_000, to: idx * 15_000 + 15_000 },
            text: ` now we grip the collar and we pull the guard step ${idx}`,
        })),
    })

    // ffmpeg writes the wav, whisper-cli the JSON next to the -of prefix.
    const tools = (whisperJson: string) =>
        onSpawn(async (child, binary, args) => {
            if (binary === 'ffmpeg') await fs.writeFile(args.at(-1) as string, 'wav')
            else await fs.writeFile(`${args[args.indexOf('-of') + 1]}.json`, whisperJson)
            child.emit('close', 0)
        })

    const CONTEXT = {
        videoTitle: 'Craig Jones Shows the Perfect Kimura',
        courses: [{ title: 'Kimura', lessonTitle: null }],
    }

    const scan = (fetchImpl: jest.Mock, durationSec: number | null = 300) =>
        scanSpeechChapters({
            config: SPEECH,
            context: CONTEXT,
            ffmpegBinary: 'ffmpeg',
            inputArgs: ['-protocol_whitelist', 'file,pipe', '-f', 'mov'],
            inputPath: '/tmp/in/source.mp4',
            durationSec,
            workdir: dir,
            timeoutMs: 60_000,
            fetchImpl: fetchImpl as never,
        })

    it('transcribes the restricted input and asks the model for chapters', async () => {
        tools(WHISPER_JSON)
        const fetchImpl = jest.fn(async () =>
            chatResponse(
                JSON.stringify({
                    chapters: [
                        { start: '00:00', title: 'Introduction' },
                        { start: '02:01', title: 'Collar Grip Guard Pull' },
                    ],
                }),
            ),
        )
        await expect(scan(fetchImpl)).resolves.toEqual({
            language: 'en',
            segments: 20,
            chapters: [
                { positionSec: 0, title: 'Introduction' },
                { positionSec: 120, title: 'Collar Grip Guard Pull' },
            ],
        })

        const [ffmpegCall, whisperCall] = spawnMock.mock.calls
        expect(ffmpegCall[1]).toEqual([
            '-y',
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-f',
            'mov',
            '-i',
            '/tmp/in/source.mp4',
            '-map',
            '0:a:0',
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            join(dir, 'speech.wav'),
        ])
        expect(whisperCall[0]).toBe('/opt/whisper-cli')
        expect(whisperCall[1]).toEqual([
            '-m',
            '/models/ggml-small.bin',
            '-f',
            join(dir, 'speech.wav'),
            '-l',
            'auto',
            '--suppress-nst',
            '-oj',
            '-of',
            join(dir, 'speech'),
            '-np',
            '--prompt',
            'Craig, Jones, Shows, Perfect, Kimura',
        ])
        const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
        expect(body.messages[1].content).toContain('Video title: Craig Jones Shows the Perfect Kimura')
        expect(body.messages[1].content).toContain('Video length: 05:00')
        // The audio and the transcript do not outlive the step.
        await expect(fs.readdir(dir)).resolves.toEqual([])
    })

    it('gives Whisper no prompt when the titles have no words to offer', async () => {
        tools(WHISPER_JSON)
        await scanSpeechChapters({
            config: SPEECH,
            context: { videoTitle: 'Vol 2 · 7', courses: [] },
            ffmpegBinary: 'ffmpeg',
            inputArgs: [],
            inputPath: '/tmp/in/source.mp4',
            durationSec: 300,
            workdir: dir,
            timeoutMs: 60_000,
            fetchImpl: jest.fn(async () => chatResponse('{"chapters":[]}')) as never,
        })
        expect(spawnMock.mock.calls[1][1]).not.toContain('--prompt')
    })

    it('measures an unknown length by the transcript', async () => {
        tools(WHISPER_JSON)
        const fetchImpl = jest.fn(async () => chatResponse('{"chapters":[]}'))
        await expect(scan(fetchImpl, null)).resolves.toMatchObject({
            chapters: [],
            rejected: '0 usable chapter(s) of 0 proposed',
        })
        const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
        expect(body.messages[1].content).toContain('Video length: 05:00')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('asks once more, with the shape spelled out, after an answer that is not JSON', async () => {
        tools(WHISPER_JSON)
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce(chatResponse('Here are the chapters you asked for.'))
            .mockResolvedValueOnce(
                chatResponse(
                    '{"chapters":[{"start":"00:00","title":"Introduction"},{"start":"02:00","title":"Collar Grip"}]}',
                ),
            )
        await expect(scan(fetchImpl)).resolves.toMatchObject({
            chapters: [
                { positionSec: 0, title: 'Introduction' },
                { positionSec: 120, title: 'Collar Grip' },
            ],
        })
        const retry = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
        expect(retry.messages.slice(2).map((m: { role: string }) => m.role)).toEqual([
            'assistant',
            'user',
        ])
        expect(retry.messages[2].content).toBe('Here are the chapters you asked for.')
    })

    it('gives up after the second answer that is not JSON', async () => {
        tools(WHISPER_JSON)
        const fetchImpl = jest.fn(async () => chatResponse('Sorry.'))
        await expect(scan(fetchImpl)).resolves.toMatchObject({
            chapters: [],
            rejected: 'answer is not a JSON chapter list',
        })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('does not ask the model about a video without speech', async () => {
        tools(JSON.stringify({ result: { language: 'en' }, transcription: [] }))
        const fetchImpl = jest.fn()
        await expect(scan(fetchImpl)).resolves.toEqual({
            language: 'en',
            segments: 0,
            chapters: [],
            rejected: 'no speech',
        })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('cleans up when a tool fails', async () => {
        onSpawn(async (child, binary, args) => {
            if (binary === 'ffmpeg') {
                await fs.writeFile(args.at(-1) as string, 'wav')
                child.emit('close', 0)
            } else {
                child.emit('close', 1)
            }
        })
        await expect(scan(jest.fn())).rejects.toThrow('whisper-cli exited with code 1')
        await expect(fs.readdir(dir)).resolves.toEqual([])
    })
})
