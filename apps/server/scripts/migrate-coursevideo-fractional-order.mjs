/**
 * One-shot, idempotent migration for CourseVideo.order: Int → String
 * (fractional indexing).
 *
 * Run BEFORE the new server starts:
 *   DATABASE_URL=... node apps/server/scripts/migrate-coursevideo-fractional-order.mjs
 * or:
 *   nx run @bjj-academy/server:migrate:coursevideo-order
 *
 * Behaviour:
 *   - If the column is still Int → cast to text using fractional keys.
 *   - If the column is already text but rows still look numeric → re-key.
 *   - Always ensures UNIQUE("courseId","order") at the end.
 *   - Drops constraint and free-standing index defensively to recover from
 *     half-finished previous runs.
 *
 * Plain ESM JS so the runtime container can execute it without tsx.
 */
import { generateNKeysBetween } from "fractional-indexing"
import pkg from "pg"

const { Client } = pkg

const UNIQUE_NAME = "CourseVideo_courseId_order_key"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error("DATABASE_URL is required")
  }

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const typeRes = await client.query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_name = 'CourseVideo' AND column_name = 'order'`,
    )
    const dataType = typeRes.rows[0]?.data_type
    if (!dataType) {
      console.log("CourseVideo table not found — nothing to migrate.")
      return
    }
    console.log(`Current column type: ${dataType}`)

    const isIntegerLike =
      dataType.includes("integer") || dataType.includes("numeric")
    const isTextLike =
      dataType === "text" || dataType === "character varying"
    if (!isIntegerLike && !isTextLike) {
      throw new Error(
        `Unexpected column type "${dataType}" — refusing to migrate`,
      )
    }

    const orderClause = isIntegerLike
      ? `"order"::int ASC`
      : `CASE WHEN "order"::text ~ '^-?\\d+$' THEN "order"::text::int END ASC, "order" ASC`
    const rowsRes = await client.query(
      `SELECT "courseId", "videoId", "order"::text AS "order"
       FROM "CourseVideo"
       ORDER BY "courseId" ASC, ${orderClause}`,
    )
    const rows = rowsRes.rows

    const looksLikeInteger = (s) => /^-?\d+$/.test(s)
    const allFractional =
      isTextLike && rows.every((r) => !looksLikeInteger(r.order))

    if (allFractional) {
      await ensureUnique(client)
      console.log(
        "CourseVideo.order is already fractional; ensured UNIQUE constraint.",
      )
      return
    }

    // Group by courseId, generate one fractional batch per course.
    const updatesByRow = new Map()
    const buckets = new Map()
    for (const row of rows) {
      const list = buckets.get(row.courseId) ?? []
      list.push(row)
      buckets.set(row.courseId, list)
    }
    for (const [, list] of buckets) {
      const keys =
        list.length === 0
          ? []
          : generateNKeysBetween(null, null, list.length)
      list.forEach((row, idx) => {
        updatesByRow.set(`${row.courseId}|${row.videoId}`, keys[idx])
      })
    }

    await client.query("BEGIN")
    try {
      await client.query(
        `ALTER TABLE "CourseVideo" DROP CONSTRAINT IF EXISTS "${UNIQUE_NAME}"`,
      )
      await client.query(`DROP INDEX IF EXISTS "${UNIQUE_NAME}"`)

      if (isIntegerLike) {
        await client.query(
          `ALTER TABLE "CourseVideo" ALTER COLUMN "order" TYPE text USING "order"::text`,
        )
      }

      for (const [composite, key] of updatesByRow) {
        const [courseId, videoId] = composite.split("|")
        await client.query(
          `UPDATE "CourseVideo" SET "order" = $1 WHERE "courseId" = $2 AND "videoId" = $3`,
          [key, courseId, videoId],
        )
      }

      await client.query(
        `ALTER TABLE "CourseVideo" ADD CONSTRAINT "${UNIQUE_NAME}" UNIQUE ("courseId", "order")`,
      )

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }

    console.log(
      `Migrated ${updatesByRow.size} rows across ${buckets.size} courses to fractional order keys.`,
    )
  } finally {
    await client.end()
  }
}

async function ensureUnique(client) {
  const r = await client.query(
    `SELECT 'constraint' AS kind FROM pg_constraint WHERE conname = $1
     UNION ALL
     SELECT 'index' AS kind FROM pg_class WHERE relname = $1 AND relkind = 'i'`,
    [UNIQUE_NAME],
  )
  if (r.rows.length > 0) return

  await client.query(
    `ALTER TABLE "CourseVideo" ADD CONSTRAINT "${UNIQUE_NAME}" UNIQUE ("courseId", "order")`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
