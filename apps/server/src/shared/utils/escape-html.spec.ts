import { escapeHtml } from './escape-html'

describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
        expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
            '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
        )
    })

    it('escapes the ampersand first, not twice', () => {
        expect(escapeHtml('&lt;')).toBe('&amp;lt;')
    })

    it('leaves plain text, including cyrillic, alone', () => {
        expect(escapeHtml('Клуб «Борцы»')).toBe('Клуб «Борцы»')
    })
})
