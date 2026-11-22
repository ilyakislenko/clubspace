import { TelegramBotClient } from './telegram-bot.client'

const config = { botToken: 'T0KEN', botUsername: 'club_bot', webhookSecret: 'sec' }

const reply = (status: number, body: unknown = {}) =>
    ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }) as Response

describe('TelegramBotClient', () => {
    const fetchMock = jest.fn()
    const realFetch = global.fetch
    beforeEach(() => {
        fetchMock.mockReset()
        global.fetch = fetchMock as never
    })
    afterAll(() => {
        global.fetch = realFetch
    })

    it('is available only with token, username and webhook secret', () => {
        expect(new TelegramBotClient(config).available).toBe(true)
        expect(new TelegramBotClient({ ...config, botToken: null }).available).toBe(false)
        expect(new TelegramBotClient({ ...config, botUsername: null }).available).toBe(false)
        expect(new TelegramBotClient({ ...config, webhookSecret: null }).available).toBe(false)
    })

    it('posts a plain-text sendMessage with a timeout', async () => {
        fetchMock.mockResolvedValue(reply(200, { ok: true }))
        const res = await new TelegramBotClient(config).sendMessage('42', 'привет')
        expect(res).toEqual({ status: 'ok' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.telegram.org/botT0KEN/sendMessage')
        expect(JSON.parse(init.body)).toMatchObject({ chat_id: '42', text: 'привет' })
        expect(JSON.parse(init.body).parse_mode).toBeUndefined()
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it.each([
        [403, 'blocked'],
        [429, 'transient'],
        [502, 'transient'],
        [400, 'error'],
    ])('classifies HTTP %i as %s', async (status, expected) => {
        fetchMock.mockResolvedValue(reply(status, { ok: false, description: 'nope' }))
        const res = await new TelegramBotClient(config).sendMessage('42', 'x')
        expect(res.status).toBe(expected)
    })

    it('treats a transport error or timeout as transient', async () => {
        fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'))
        const res = await new TelegramBotClient(config).sendMessage('42', 'x')
        expect(res.status).toBe('transient')
    })

    it('sends nothing without a token', async () => {
        const res = await new TelegramBotClient({ ...config, botToken: null }).sendMessage(
            '42',
            'x',
        )
        expect(res.status).toBe('error')
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
