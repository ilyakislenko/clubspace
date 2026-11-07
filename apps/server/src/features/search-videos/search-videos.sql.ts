import { Prisma } from '../../infrastructure/prisma'
import { MAX_MOMENTS_PER_VIDEO } from './search-videos-utils'

// Candidates fetched before the exact ranking (rankVideoHits) and the cap.
export const SEARCH_CANDIDATE_LIMIT = 200

// One kind of moment over a JSON cue list [{from, to, text}] (a transcript's
// segments, or its translations->'ru'): how many cues match, and the first
// MAX_MOMENTS_PER_VIDEO of them. A value that isn't an array counts as none.
const cueHits = (cues: Prisma.Sql, pattern: string) => Prisma.sql`
    SELECT count(*)::int AS hits,
           jsonb_agg(jsonb_build_object('at', c.at, 'text', c.text) ORDER BY c.at)
               FILTER (WHERE c.rn <= ${MAX_MOMENTS_PER_VIDEO}) AS moments
    FROM (
        SELECT (e->>'from')::float8 AS at,
               e->>'text' AS text,
               row_number() OVER (ORDER BY (e->>'from')::float8) AS rn
        FROM "VideoTranscript" tr
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(${cues}) = 'array' THEN ${cues} ELSE '[]'::jsonb END
        ) e
        WHERE tr."videoId" = v.id
          AND e->>'text' ILIKE ${pattern} ESCAPE '\\'
    ) c
`

/**
 * One query over the given (watchable, ready) videos of the club: title hit,
 * chapter-title hits, and hits in what's said — the transcript and its
 * Russian translation — each with its first moments. Only videos with a hit,
 * roughly ranked, at most SEARCH_CANDIDATE_LIMIT.
 */
export const searchVideosSql = (params: {
    workspaceId: string
    videoIds: readonly string[]
    pattern: string
}): Prisma.Sql => {
    const { workspaceId, videoIds, pattern } = params
    return Prisma.sql`
        SELECT v.id,
               v.title,
               v."thumbnailUrl",
               v.duration,
               (v.title ILIKE ${pattern} ESCAPE '\\') AS "titleHit",
               COALESCE(ch.hits, 0) AS "chapterHits",
               ch.moments AS "chapterMoments",
               COALESCE(sp.hits, 0) AS "speechHits",
               sp.moments AS "speechMoments",
               COALESCE(ru.hits, 0) AS "speechRuHits",
               ru.moments AS "speechRuMoments"
        FROM "Video" v
        LEFT JOIN LATERAL (
            SELECT count(*)::int AS hits,
                   jsonb_agg(jsonb_build_object('at', t."positionSec", 'text', t.title)
                       ORDER BY t."positionSec")
                       FILTER (WHERE t.rn <= ${MAX_MOMENTS_PER_VIDEO}) AS moments
            FROM (
                SELECT ts."positionSec", ts.title,
                       row_number() OVER (ORDER BY ts."positionSec") AS rn
                FROM "VideoTimestamp" ts
                WHERE ts."videoId" = v.id
                  AND ts.title ILIKE ${pattern} ESCAPE '\\'
            ) t
        ) ch ON true
        LEFT JOIN LATERAL (${cueHits(Prisma.sql`tr.segments`, pattern)}) sp ON true
        LEFT JOIN LATERAL (${cueHits(Prisma.sql`(tr.translations -> 'ru')`, pattern)}) ru ON true
        WHERE v."workspaceId" = ${workspaceId}::uuid
          AND v.id = ANY(${[...videoIds]}::uuid[])
          AND (
              v.title ILIKE ${pattern} ESCAPE '\\'
              OR ch.hits > 0
              OR sp.hits > 0
              OR ru.hits > 0
          )
        ORDER BY (v.title ILIKE ${pattern} ESCAPE '\\') DESC,
                 (ch.hits > 0) DESC,
                 (COALESCE(sp.hits, 0) + COALESCE(ru.hits, 0)) DESC,
                 v.title ASC
        LIMIT ${SEARCH_CANDIDATE_LIMIT}
    `
}
