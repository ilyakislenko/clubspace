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

    it('neutralises formula-injection triggers in string cells', () => {
        const csv = toCsv(
            ['a', 'b', 'c', 'd'],
            [['=1+1', '+cmd', '-2', '@SUM(A1)']],
        )
        // Each is prefixed with an apostrophe; the ones with a comma get quoted.
        expect(csv).toBe(`${BOM}a,b,c,d\r\n'=1+1,'+cmd,'-2,'@SUM(A1)`)
    })

    it('quotes a neutralised cell that also contains a delimiter', () => {
        expect(toCsv(['x'], [['=HYPERLINK("http://x","y")']])).toBe(
            `${BOM}x\r\n"'=HYPERLINK(""http://x"",""y"")"`,
        )
    })

    it('does not touch negative numbers (numeric cells stay numeric)', () => {
        expect(toCsv(['n'], [[-5]])).toBe(`${BOM}n\r\n-5`)
    })
})
