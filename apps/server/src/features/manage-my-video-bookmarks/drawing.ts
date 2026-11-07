import { z } from 'zod'

/**
 * A member's sketch over a paused frame («Рисование поверх паузы»), stored on
 * the bookmark it was saved with. Coordinates are normalized to the video
 * frame (0..1 from its left/top edge, never to the screen), so a drawing lands
 * on the same spot of the picture on any device or orientation. Colors are
 * palette keys, not CSS — each client maps them to its own theme.
 *
 * Bounded so a synced row stays small: a broken or hostile client can't park
 * megabytes of JSON on a bookmark.
 */
export const DRAWING_TOOLS = ['pen', 'arrow', 'ellipse'] as const
export const DRAWING_COLORS = ['red', 'yellow', 'green', 'white'] as const
export const DRAWING_MAX_STROKES = 64
export const DRAWING_MAX_POINTS = 2000

const Coordinate = z.number().min(0).max(1)

const DrawingStrokeSchema = z
    .object({
        tool: z.enum(DRAWING_TOOLS),
        color: z.enum(DRAWING_COLORS),
        // Flat [x0, y0, x1, y1, …]. An arrow runs from the first point to the
        // second; an ellipse fills the box between its two points.
        points: z.array(Coordinate).min(4).max(DRAWING_MAX_POINTS * 2),
    })
    .refine((s) => s.points.length % 2 === 0, {
        message: 'Координаты штриха должны идти парами',
        path: ['points'],
    })
    .refine((s) => s.tool === 'pen' || s.points.length === 4, {
        message: 'Стрелка и овал задаются двумя точками',
        path: ['points'],
    })

export const BookmarkDrawingSchema = z
    .object({
        strokes: z.array(DrawingStrokeSchema).min(1).max(DRAWING_MAX_STROKES),
    })
    .refine(
        (d) =>
            d.strokes.reduce((n, s) => n + s.points.length / 2, 0) <=
            DRAWING_MAX_POINTS,
        {
            message: `В рисунке не больше ${DRAWING_MAX_POINTS} точек`,
            path: ['strokes'],
        },
    )

export type BookmarkDrawing = z.infer<typeof BookmarkDrawingSchema>

/** A stored value as a drawing, or null when absent or not a valid one. */
export const parseStoredDrawing = (value: unknown): BookmarkDrawing | null => {
    if (value === null || value === undefined) return null
    const parsed = BookmarkDrawingSchema.safeParse(value)
    return parsed.success ? parsed.data : null
}
