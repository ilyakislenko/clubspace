import { resolvePublicUrl } from './public-urls'

const base = {
    explicit: undefined,
    rootUrl: 'https://api.club.example',
    subdomain: 'admin' as const,
    devDefault: 'http://localhost:4200',
    production: true,
}

describe('resolvePublicUrl', () => {
    it('uses the explicit value and strips trailing slashes', () => {
        expect(
            resolvePublicUrl({ ...base, explicit: 'https://a.example//' }),
        ).toBe('https://a.example')
    })

    it('prefers the explicit value outside production too', () => {
        expect(
            resolvePublicUrl({
                ...base,
                explicit: 'https://a.example',
                production: false,
            }),
        ).toBe('https://a.example')
    })

    it('falls back to the dev default outside production', () => {
        expect(resolvePublicUrl({ ...base, production: false })).toBe(
            'http://localhost:4200',
        )
    })

    it('derives the host from an api.<domain> ROOT_URL', () => {
        expect(resolvePublicUrl(base)).toBe('https://admin.club.example')
        expect(resolvePublicUrl({ ...base, subdomain: 'app' })).toBe(
            'https://app.club.example',
        )
    })

    it('keeps the port and drops any path when deriving', () => {
        expect(
            resolvePublicUrl({
                ...base,
                rootUrl: 'https://api.club.example:8443/v1',
            }),
        ).toBe('https://admin.club.example:8443')
    })

    it('answers null in production when nothing can be derived', () => {
        expect(
            resolvePublicUrl({ ...base, rootUrl: 'http://localhost:3000' }),
        ).toBeNull()
        expect(
            resolvePublicUrl({
                ...base,
                subdomain: 'app',
                rootUrl: 'https://club.example',
            }),
        ).toBeNull()
    })
})
