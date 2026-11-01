import { z } from 'zod'

import { strictBoolean } from './strict-boolean'

describe('strictBoolean', () => {
    const schema = strictBoolean()

    it.each([
        [true, true],
        [false, false],
        ['true', true],
        ['false', false],
    ])('parses %p as %p', (input, expected) => {
        expect(schema.parse(input)).toBe(expected)
    })

    it.each(['1', '0', 'yes', 'on', '', 'False', 1, 0, null])(
        'refuses %p',
        (input) => {
            expect(schema.safeParse(input).success).toBe(false)
        },
    )

    it('stays a plain boolean in the API contract', () => {
        expect(z.toJSONSchema(schema, { io: 'input' })).toMatchObject({
            type: 'boolean',
        })
    })

    it('leaves an optional field unset', () => {
        expect(
            z.object({ flag: strictBoolean().optional() }).parse({}),
        ).toEqual({})
    })
})
