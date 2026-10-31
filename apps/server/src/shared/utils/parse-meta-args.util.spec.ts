import { MAX_PER_PAGE, parseMetaArgs } from './parse-meta-args.util'

describe('parseMetaArgs', () => {
    it('defaults to page 1 of 10', () => {
        expect(parseMetaArgs({})).toEqual({
            take: 10,
            skip: 0,
            curPage: 1,
            perPage: 10,
        })
    })

    it('offsets by whole pages', () => {
        expect(parseMetaArgs({ curPage: 3, perPage: 20 })).toMatchObject({
            take: 20,
            skip: 40,
        })
    })

    it('caps the page size', () => {
        expect(parseMetaArgs({ perPage: 1_000_000 })).toMatchObject({
            take: MAX_PER_PAGE,
            perPage: MAX_PER_PAGE,
        })
    })

    it('never goes below page 1 or a page of 1', () => {
        expect(parseMetaArgs({ curPage: -2, perPage: -5 })).toMatchObject({
            curPage: 1,
            take: 1,
            skip: 0,
        })
    })

    it('uses caller defaults', () => {
        expect(
            parseMetaArgs({ defaults: { curPage: 2, perPage: 5 } }),
        ).toMatchObject({ curPage: 2, perPage: 5, skip: 5 })
    })
})
