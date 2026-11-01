import { BadRequestError } from '../errors/shared.errors'
import { resolveRequestWorkspaceId } from './resolve-workspace-id'

describe('resolveRequestWorkspaceId', () => {
    it('returns undefined when no source names a club', () => {
        expect(resolveRequestWorkspaceId({})).toBeUndefined()
        expect(
            resolveRequestWorkspaceId({ params: {}, query: {}, body: {} }),
        ).toBeUndefined()
    })

    it.each([
        ['params', { params: { workspaceId: 'A' } }],
        ['query', { query: { workspaceId: 'A' } }],
        ['body', { body: { workspaceId: 'A' } }],
    ])('reads a club named only in %s', (_source, req) => {
        expect(resolveRequestWorkspaceId(req)).toBe('A')
    })

    it('accepts the same club named in every source', () => {
        expect(
            resolveRequestWorkspaceId({
                params: { workspaceId: 'A' },
                query: { workspaceId: 'A' },
                body: { workspaceId: 'A' },
            }),
        ).toBe('A')
    })

    // The C1 attack: guards used to check the body while the handler read
    // the query. Any disagreement is refused instead of picking a winner.
    it.each([
        ['query vs body', { query: { workspaceId: 'B' }, body: { workspaceId: 'A' } }],
        ['params vs query', { params: { workspaceId: 'A' }, query: { workspaceId: 'B' } }],
        ['params vs body', { params: { workspaceId: 'A' }, body: { workspaceId: 'B' } }],
    ])('refuses different clubs (%s)', (_label, req) => {
        expect(() => resolveRequestWorkspaceId(req)).toThrow(BadRequestError)
        expect(() => resolveRequestWorkspaceId(req)).toThrow(
            'В запросе указаны разные клубы',
        )
    })

    it('refuses a repeated query parameter (parsed as an array)', () => {
        expect(() =>
            resolveRequestWorkspaceId({ query: { workspaceId: ['A', 'B'] } }),
        ).toThrow('Некорректный идентификатор клуба')
    })

    it.each([{ id: 'A' }, 42, true])('refuses a non-string id %p', (value) => {
        expect(() =>
            resolveRequestWorkspaceId({ body: { workspaceId: value } }),
        ).toThrow(BadRequestError)
    })

    it('treats an empty string and null as absent', () => {
        expect(
            resolveRequestWorkspaceId({
                query: { workspaceId: '' },
                body: { workspaceId: 'A' },
            }),
        ).toBe('A')
        expect(
            resolveRequestWorkspaceId({ body: { workspaceId: null } }),
        ).toBeUndefined()
    })

    it('ignores a body that is not an object', () => {
        expect(resolveRequestWorkspaceId({ body: 'workspaceId=A' })).toBeUndefined()
        expect(
            resolveRequestWorkspaceId({ body: [{ workspaceId: 'B' }] }),
        ).toBeUndefined()
    })
})
