import { appLinksHtml, buildAppLinks, buildJoinUrl } from './invite-links'

describe('buildJoinUrl', () => {
    it('joins the app url and the unhyphenated code', () => {
        expect(buildJoinUrl('https://app.club.example', 'ABCD2345')).toBe(
            'https://app.club.example/join/ABCD2345',
        )
    })
})

describe('buildAppLinks', () => {
    it('maps unset store links to null', () => {
        expect(buildAppLinks({ appUrl: 'https://app.x' })).toEqual({
            web: 'https://app.x',
            googlePlay: null,
            ruStore: null,
        })
    })

    it('passes the configured store links through', () => {
        expect(
            buildAppLinks({
                appUrl: 'https://app.x',
                playStoreUrl: 'https://play.google.com/x',
                ruStoreUrl: 'https://rustore.ru/x',
            }),
        ).toEqual({
            web: 'https://app.x',
            googlePlay: 'https://play.google.com/x',
            ruStore: 'https://rustore.ru/x',
        })
    })
})

describe('appLinksHtml', () => {
    it('leaves out the links that are not set', () => {
        const html = appLinksHtml({
            web: 'https://app.x',
            googlePlay: null,
            ruStore: null,
        })
        expect(html).toContain('Открыть в браузере')
        expect(html).not.toContain('Google Play')
        expect(html).not.toContain('RuStore')
    })

    it('renders every button, store buttons first', () => {
        const html = appLinksHtml({
            web: 'https://app.x',
            googlePlay: 'https://p.x',
            ruStore: 'https://r.x',
        })
        expect(html.indexOf('Google Play')).toBeLessThan(html.indexOf('RuStore'))
        expect(html.indexOf('RuStore')).toBeLessThan(
            html.indexOf('Открыть в браузере'),
        )
    })

    it('escapes every href', () => {
        const html = appLinksHtml({
            web: 'https://app.x/?a=1&b="2"',
            googlePlay: null,
            ruStore: null,
        })
        expect(html).toContain('href="https://app.x/?a=1&amp;b=&quot;2&quot;"')
    })
})
