import { z } from 'zod'

import { uuidListQuery } from './uuid-list-query'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('uuidListQuery', () => {
    const schema = uuidListQuery(2)

    it('splits a comma-separated list', () => {
        expect(schema.parse(`${A},${B}`)).toEqual([A, B])
        expect(schema.parse(A)).toEqual([A])
    })

    it('reads an empty string as no ids', () => {
        expect(schema.parse('')).toEqual([])
    })

    it.each([`${A},nope`, `${A},`, `${A},${B},${A}`, [A]])(
        'refuses %p',
        (input) => {
            expect(schema.safeParse(input).success).toBe(false)
        },
    )

    it('stays a plain string in the API contract', () => {
        expect(z.toJSONSchema(schema, { io: 'input' })).toMatchObject({
            type: 'string',
        })
    })

    it('leaves an optional field unset', () => {
        expect(
            z.object({ ids: uuidListQuery(2).optional() }).parse({}),
        ).toEqual({})
    })
})
