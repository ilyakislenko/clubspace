import { BadRequestError } from '../../../shared/errors/shared.errors'
import {
    isMultipartUpload,
    orderCompletedParts,
    planUploadParts,
    S3_MAX_PARTS,
} from './multipart-upload'

const MiB = 1024 * 1024

describe('isMultipartUpload', () => {
    it('splits only a declared size bigger than one part', () => {
        expect(isMultipartUpload(undefined, 64 * MiB)).toBe(false)
        expect(isMultipartUpload(64 * MiB, 64 * MiB)).toBe(false)
        expect(isMultipartUpload(64 * MiB + 1, 64 * MiB)).toBe(true)
    })
})

describe('planUploadParts', () => {
    it('cuts full parts and a shorter last one', () => {
        expect(planUploadParts(1_000, 300)).toEqual([
            { partNumber: 1, contentLength: 300 },
            { partNumber: 2, contentLength: 300 },
            { partNumber: 3, contentLength: 300 },
            { partNumber: 4, contentLength: 100 },
        ])
    })

    it('ends on a full part when the size divides evenly', () => {
        const plan = planUploadParts(5120 * MiB, 64 * MiB)
        expect(plan).toHaveLength(80)
        expect(plan.every((p) => p.contentLength === 64 * MiB)).toBe(true)
        expect(plan.reduce((sum, p) => sum + p.contentLength, 0)).toBe(5120 * MiB)
    })

    it('refuses a file that would need more parts than S3 allows', () => {
        expect(planUploadParts(S3_MAX_PARTS * 10, 10)).toHaveLength(S3_MAX_PARTS)
        expect(() => planUploadParts(S3_MAX_PARTS * 10 + 1, 10)).toThrow(BadRequestError)
    })
})

describe('orderCompletedParts', () => {
    it('sorts the parts by number', () => {
        expect(
            orderCompletedParts([
                { partNumber: 3, etag: 'c' },
                { partNumber: 1, etag: 'a' },
                { partNumber: 2, etag: 'b' },
            ]).map((p) => p.etag),
        ).toEqual(['a', 'b', 'c'])
    })

    it.each([
        ['a gap', [1, 3]],
        ['a repeat', [1, 2, 2]],
        ['no first part', [2, 3]],
    ])('refuses %s', (_case, numbers) => {
        expect(() =>
            orderCompletedParts(numbers.map((partNumber) => ({ partNumber, etag: 'x' }))),
        ).toThrow(BadRequestError)
    })
})
