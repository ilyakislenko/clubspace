import { isSameItemSet, isValidItemRange } from './study-plans-utils'

describe('isValidItemRange', () => {
    it.each([
        [10, null, true],
        [10, 11, true],
        [10, 10, false],
        [10, 5, false],
    ])('start %i, end %p → %p', (start, end, ok) => {
        expect(isValidItemRange(start, end)).toBe(ok)
    })
})

describe('isSameItemSet', () => {
    it.each([
        [['a', 'b'], ['b', 'a'], true],
        [[], [], true],
        [['a', 'b'], ['a'], false],
        [['a', 'b'], ['a', 'a'], false],
        [['a', 'b'], ['a', 'b', 'c'], false],
        [['a', 'b'], ['a', 'c'], false],
    ])('%p vs %p → %p', (current, requested, same) => {
        expect(isSameItemSet(current, requested)).toBe(same)
    })
})
