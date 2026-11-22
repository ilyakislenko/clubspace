import {
    formatTelegramText,
    generateTelegramLinkToken,
    hashTelegramLinkToken,
    looksLikeTelegramLinkToken,
    parseTelegramCommand,
    telegramDeepLink,
    telegramSecretMatches,
} from './telegram-utils'

describe('telegram link tokens', () => {
    it('generates a start-parameter-safe token and stores only its hash', () => {
        const a = generateTelegramLinkToken()
        const b = generateTelegramLinkToken()
        expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
        expect(looksLikeTelegramLinkToken(a.token)).toBe(true)
        expect(a.hash).toBe(hashTelegramLinkToken(a.token))
        expect(a.hash).not.toContain(a.token)
        expect(a.token).not.toBe(b.token)
    })

    it('refuses values that cannot be a token before any lookup', () => {
        expect(looksLikeTelegramLinkToken('short')).toBe(false)
        expect(looksLikeTelegramLinkToken('a'.repeat(65))).toBe(false)
        expect(looksLikeTelegramLinkToken('has spaces in it, 12345678')).toBe(false)
    })

    it('builds the t.me deep link', () => {
        expect(telegramDeepLink('club_bot', 'tok')).toBe('https://t.me/club_bot?start=tok')
    })
})

describe('parseTelegramCommand', () => {
    it.each([
        ['/start abc', { command: 'start', arg: 'abc' }],
        ['/start', { command: 'start', arg: null }],
        ['  /start@club_bot abc  ', { command: 'start', arg: 'abc' }],
        ['/stop', { command: 'stop' }],
        ['/stop@club_bot', { command: 'stop' }],
    ])('%s', (text, expected) => {
        expect(parseTelegramCommand(text)).toEqual(expected)
    })

    it.each(['hello', '/help', '/start a b', '/started', 'start abc'])(
        'ignores %s',
        (text) => {
            expect(parseTelegramCommand(text)).toBeNull()
        },
    )
})

describe('telegramSecretMatches', () => {
    it('accepts only the exact secret', () => {
        expect(telegramSecretMatches('s3cret', 's3cret')).toBe(true)
        expect(telegramSecretMatches('s3cret', 's3cre')).toBe(false)
        expect(telegramSecretMatches('s3cret', 'S3CRET')).toBe(false)
        expect(telegramSecretMatches('s3cret', undefined)).toBe(false)
        expect(telegramSecretMatches('s3cret', '')).toBe(false)
    })
})

describe('formatTelegramText', () => {
    it('joins title, body and the notification link', () => {
        expect(
            formatTelegramText(
                { topic: 'Аналитика', message: '3 факта', link: 'https://admin.x/analytics' },
                'https://app.x',
            ),
        ).toBe('Аналитика\n\n3 факта\n\nhttps://admin.x/analytics')
    })

    it('falls back to the app when the row has no web link', () => {
        expect(
            formatTelegramText({ topic: 'Т', message: 'Б', link: null }, 'https://app.x'),
        ).toBe('Т\n\nБ\n\nhttps://app.x')
        expect(formatTelegramText({ topic: 'Т', message: 'Б', link: '/schedule' }, null)).toBe(
            'Т\n\nБ',
        )
    })

    it('stays inside the 4096-character limit and keeps the link', () => {
        const text = formatTelegramText(
            { topic: 'T', message: 'x'.repeat(5000), link: null },
            'https://app.x',
        )
        expect(text.length).toBe(4096)
        expect(text.endsWith('\n\nhttps://app.x')).toBe(true)
    })
})
