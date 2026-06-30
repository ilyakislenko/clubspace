import { ExpoPushClient, ExpoPushMessage } from './expo-push.client'

const msg = (to: string): ExpoPushMessage => ({
    to,
    title: 't',
    body: 'b',
})

const okResponse = (tickets: unknown[]) =>
    ({
        ok: true,
        json: async () => ({ data: tickets }),
    }) as never

describe('ExpoPushClient.send', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('returns no tickets for an empty batch without calling fetch', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch' as never)
        const client = new ExpoPushClient()

        expect(await client.send([])).toEqual([])
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('posts messages and returns the tickets in order', async () => {
        const tickets = [
            { status: 'ok', id: 'a' },
            { status: 'ok', id: 'b' },
        ]
        const fetchSpy = jest
            .spyOn(global, 'fetch' as never)
            .mockResolvedValue(okResponse(tickets))
        const client = new ExpoPushClient()

        const result = await client.send([msg('x'), msg('y')])

        expect(result).toEqual(tickets)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const body = JSON.parse(
            (fetchSpy.mock.calls[0][1] as { body: string }).body,
        )
        expect(body).toHaveLength(2)
        expect(body[0]).toMatchObject({ to: 'x', sound: 'default' })
    })

    it('chunks into batches of 100', async () => {
        const fetchSpy = jest
            .spyOn(global, 'fetch' as never)
            .mockResolvedValue(okResponse([{ status: 'ok', id: 'z' }]))
        const client = new ExpoPushClient()

        const messages = Array.from({ length: 250 }, (_, i) => msg(`t${i}`))
        await client.send(messages)

        expect(fetchSpy).toHaveBeenCalledTimes(3) // 100 + 100 + 50
    })

    it('throws on a non-2xx response so the caller can retry', async () => {
        jest.spyOn(global, 'fetch' as never).mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => 'rate limited',
        } as never)
        const client = new ExpoPushClient()

        await expect(client.send([msg('x')])).rejects.toThrow(/429/)
    })
})
