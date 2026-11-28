import { Prisma } from '../../infrastructure/prisma'

// Cue-level candidates fetched before pickMoments chooses the excerpts.
export const MOMENT_CANDIDATE_LIMIT = 300

// Every cue of a JSON cue list [{from, to, text}] (a transcript's segments or
// its translations->'ru') of the given videos. A value that isn't an array
// counts as none.
const cues = (list: Prisma.Sql, kind: string, videoIds: readonly string[]) => Prisma.sql`
    SELECT tr."videoId" AS "videoId", ${kind}::text AS kind,
           (e->>'from')::float8 AS at, e->>'text' AS text
    FROM "VideoTranscript" tr
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(${list}) = 'array' THEN ${list} ELSE '[]'::jsonb END
    ) e
    WHERE tr."videoId" = ANY(${[...videoIds]}::uuid[])
`

/**
 * «Спросить ИИ по видео клуба» retrieval: the chapter titles and the cues of
 * what's said (transcript and its Russian translation) in the given
 * (watchable, ready) videos of the club that name any of the search terms,
 * with how many terms each names (`score`) and how many the video title
 * names (`titleScore`). The patterns are likePattern()s — backslash is
 * Postgres's default LIKE escape, so `ILIKE ANY` keeps them literal.
 */
export const askClubVideosMomentsSql = (params: {
    workspaceId: string
    videoIds: readonly string[]
    patterns: readonly string[]
}): Prisma.Sql => {
    const { workspaceId, videoIds, patterns } = params
    const pats = Prisma.sql`${[...patterns]}::text[]`
    return Prisma.sql`
        SELECT c."videoId", v.title, c.kind, c.at, c.text,
               (SELECT count(*)::int FROM unnest(${pats}) p WHERE c.text ILIKE p) AS score,
               (SELECT count(*)::int FROM unnest(${pats}) p WHERE v.title ILIKE p) AS "titleScore"
        FROM (
            ${cues(Prisma.sql`tr.segments`, 'speech', videoIds)}
            UNION ALL
            ${cues(Prisma.sql`(tr.translations -> 'ru')`, 'speechRu', videoIds)}
            UNION ALL
            SELECT ts."videoId", 'chapter'::text, ts."positionSec"::float8, ts.title
            FROM "VideoTimestamp" ts
            WHERE ts."videoId" = ANY(${[...videoIds]}::uuid[])
        ) c
        JOIN "Video" v ON v.id = c."videoId"
        WHERE v."workspaceId" = ${workspaceId}::uuid
          AND c.text ILIKE ANY(${pats})
        ORDER BY score DESC, c."videoId", c.at
        LIMIT ${MOMENT_CANDIDATE_LIMIT}
    `
}
