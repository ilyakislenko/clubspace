import { toCsv } from './csv'

const BOM = String.fromCharCode(0xfeff)

describe('toCsv', () => {
    it('prepends a BOM, uses CRLF, and joins headers + rows', () => {
        const csv = toCsv(
            ['name', 'email'],
            [
                ['Alice', 'a@x'],
                ['Bob', 'b@x'],
            ],
        )
        expect(csv).toBe(`${BOM}name,email\r\nAlice,a@x\r\nBob,b@x`)
    })

    it('quotes fields with commas, quotes, or newlines (doubling quotes)', () => {
        const csv = toCsv(
            ['title'],
            [['a, b'], ['say "hi"'], ['line1\nline2']],
        )
        expect(csv).toBe(
            `${BOM}title\r\n"a, b"\r\n"say ""hi"""\r\n"line1\nline2"`,
        )
    })

    it('renders null/undefined as empty and numbers as-is', () => {
        const csv = toCsv(['a', 'b', 'c'], [[null, undefined, 42]])
        expect(csv).toBe(`${BOM}a,b,c\r\n,,42`)
    })

    it('quotes edge whitespace so it survives round-trips', () => {
        expect(toCsv(['x'], [[' pad ']])).toBe(`${BOM}x\r\n" pad "`)
    })
})
