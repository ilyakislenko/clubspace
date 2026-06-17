import { reorderIds } from './reorder'

describe('reorderIds', () => {
    const ids = ['a', 'b', 'c', 'd']

    it('moves to the front with afterId=null', () => {
        expect(reorderIds(ids, 'c', { afterId: null })).toEqual([
            'c',
            'a',
            'b',
            'd',
        ])
    })

    it('moves to the end with beforeId=null', () => {
        expect(reorderIds(ids, 'a', { beforeId: null })).toEqual([
            'b',
            'c',
            'd',
            'a',
        ])
    })

    it('inserts directly after a neighbour', () => {
        expect(reorderIds(ids, 'd', { afterId: 'a' })).toEqual([
            'a',
            'd',
            'b',
            'c',
        ])
    })

    it('inserts directly before a neighbour', () => {
        expect(reorderIds(ids, 'a', { beforeId: 'c' })).toEqual([
            'b',
            'a',
            'c',
            'd',
        ])
    })

    it('falls back to the end when neither anchor is given', () => {
        expect(reorderIds(ids, 'b', {})).toEqual(['a', 'c', 'd', 'b'])
    })

    it('is a permutation — never drops or duplicates an id', () => {
        const out = reorderIds(ids, 'b', { afterId: 'd' })
        expect([...out].sort()).toEqual([...ids].sort())
        expect(out).toHaveLength(ids.length)
    })

    it('a no-op anchor (after the item already before it) keeps order stable', () => {
        // 'b' after 'a' — already its position; result is unchanged order.
        expect(reorderIds(ids, 'b', { afterId: 'a' })).toEqual(ids)
    })
})
