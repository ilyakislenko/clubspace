// Hard ceiling on one page: a caller-chosen perPage=1e6 is a cheap DoS.
export const MAX_PER_PAGE = 100

interface ParseMetaArgsPayload {
    curPage?: number
    perPage?: number
    defaults?: {
        curPage: number
        perPage: number
    }
}

export function parseMetaArgs(data: ParseMetaArgsPayload): {
    take: number
    skip: number
    curPage: number
    perPage: number
} {
    const { curPage, perPage } = data

    let { defaults } = data

    if (!defaults) {
        defaults = {
            curPage: 1,
            perPage: 10,
        }
    }
    const parsedCurrentPage = Math.max(1, Math.floor(curPage || defaults.curPage))
    const parsedPerPage = Math.min(
        MAX_PER_PAGE,
        Math.max(1, Math.floor(perPage || defaults.perPage)),
    )
    const skip =
        parsedCurrentPage === 1
            ? 0
            : parsedPerPage * parsedCurrentPage - parsedPerPage

    return {
        take: parsedPerPage,
        skip,
        curPage: parsedCurrentPage,
        perPage: parsedPerPage,
    }
}
