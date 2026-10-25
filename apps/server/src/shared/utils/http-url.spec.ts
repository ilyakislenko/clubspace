import { isHttpUrl } from './http-url'

describe('isHttpUrl', () => {
    it.each([
        ['https://club.example'],
        ['http://club.example/path?x=1'],
        ['HTTPS://CLUB.EXAMPLE'],
    ])('accepts %s', (v) => {
        expect(isHttpUrl(v)).toBe(true)
    })

    it.each([
        ['javascript:alert(1)'],
        ['JavaScript:alert(1)'],
        ['data:text/html,<b>x</b>'],
        ['ftp://club.example'],
        ['club.example'],
        [''],
        ['java\tscript:alert(1)'],
    ])('rejects %p', (v) => {
        expect(isHttpUrl(v)).toBe(false)
    })
})
