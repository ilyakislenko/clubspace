// Pure geometry behind «Рисование поверх паузы»: where the picture actually
// sits inside the player (contain letterboxing), screen ⇄ frame coordinates
// (mirror included), stroke simplification and the server's size limits.
// Kept free of React so the edge cases are unit-tested.
import type { BookmarkDrawing, DrawingStroke } from "../../shared/api/video-study"

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }

// A saved drawing on screen: its bookmark and the second of its frame.
export type ShownDrawing = {
  bookmarkId: string
  positionSec: number
  drawing: BookmarkDrawing
}

// The shown drawing goes away once the picture is farther than this from its
// frame (a seek, frame steps past it).
export const SHOWN_DRAWING_DRIFT_SEC = 0.5

// Same limits as the server's BookmarkDrawingSchema: a drawing past them
// would be refused forever.
export const DRAWING_MAX_STROKES = 64
export const DRAWING_MAX_POINTS = 2000

// Pen strokes drop points closer than this to the simplified line (in frame
// units: 0.002 ≈ 2 px across a 1000 px wide picture).
export const SIMPLIFY_TOLERANCE = 0.002
// Stored coordinates keep 4 decimals — finer than any screen pixel.
const PRECISION = 10_000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const round = (n: number) => Math.round(n * PRECISION) / PRECISION

/**
 * The rect the picture occupies in a `container` with `contentFit="contain"`:
 * scaled to fit, centered, bars on the two other sides. Unknown video size =
 * the whole container.
 */
export const containRect = (container: Size, video: Size | null): Rect => {
  if (
    !video ||
    video.width <= 0 ||
    video.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { x: 0, y: 0, ...container }
  }
  const scale = Math.min(
    container.width / video.width,
    container.height / video.height,
  )
  const width = video.width * scale
  const height = video.height * scale
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

/**
 * A touch at (`x`, `y`) in container pixels as frame coordinates (0..1 from the
 * picture's own left/top). With the picture mirrored, its left edge is drawn
 * on the right, so x flips. Touches on the bars clamp to the nearest edge.
 */
export const toFrame = (
  x: number,
  y: number,
  rect: Rect,
  mirrored: boolean,
): [number, number] => {
  const nx = rect.width > 0 ? clamp01((x - rect.x) / rect.width) : 0
  const ny = rect.height > 0 ? clamp01((y - rect.y) / rect.height) : 0
  return [round(mirrored ? 1 - nx : nx), round(ny)]
}

/** Frame coordinates back to container pixels (inverse of `toFrame`). */
export const toScreen = (
  fx: number,
  fy: number,
  rect: Rect,
  mirrored: boolean,
): [number, number] => [
  rect.x + (mirrored ? 1 - fx : fx) * rect.width,
  rect.y + fy * rect.height,
]

// Distance from p to the segment a–b.
const segmentDistance = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Ramer–Douglas–Peucker over a flat [x0, y0, x1, y1, …] polyline: keeps the
 * ends and every point farther than `tolerance` from the simplified line.
 */
export const simplifyStroke = (
  points: readonly number[],
  tolerance: number = SIMPLIFY_TOLERANCE,
): number[] => {
  const count = Math.floor(points.length / 2)
  if (count <= 2) return points.slice(0, count * 2)
  const keep = new Array<boolean>(count).fill(false)
  keep[0] = true
  keep[count - 1] = true
  const stack: [number, number][] = [[0, count - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number]
    let worst = -1
    let worstDistance = tolerance
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(
        points[i * 2],
        points[i * 2 + 1],
        points[from * 2],
        points[from * 2 + 1],
        points[to * 2],
        points[to * 2 + 1],
      )
      if (d > worstDistance) {
        worst = i
        worstDistance = d
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      stack.push([from, worst], [worst, to])
    }
  }
  return keep.flatMap((k, i) => (k ? [points[i * 2], points[i * 2 + 1]] : []))
}

export const drawingPointCount = (strokes: readonly DrawingStroke[]): number =>
  strokes.reduce((n, s) => n + s.points.length / 2, 0)

/** Whether one more stroke still fits the server's limits. */
export const canAddStroke = (
  strokes: readonly DrawingStroke[],
  stroke: DrawingStroke,
): boolean =>
  strokes.length < DRAWING_MAX_STROKES &&
  drawingPointCount(strokes) + stroke.points.length / 2 <= DRAWING_MAX_POINTS

/**
 * The finished stroke from the raw touch track, or null when it is too small
 * to mean anything (a tap): a pen keeps its simplified path; an arrow or an
 * ellipse only its first and last point.
 */
export const finishStroke = (
  tool: DrawingStroke["tool"],
  color: DrawingStroke["color"],
  track: readonly number[],
): DrawingStroke | null => {
  if (track.length < 4) return null
  const points =
    tool === "pen"
      ? simplifyStroke(track)
      : [track[0], track[1], track[track.length - 2], track[track.length - 1]]
  const [x0, y0] = points
  const moved = points.some(
    (v, i) => Math.abs(v - (i % 2 === 0 ? x0 : y0)) > SIMPLIFY_TOLERANCE,
  )
  return moved ? { tool, color, points } : null
}

/**
 * The two short lines of an arrow head at (x1, y1), pointing away from
 * (x0, y0); `size` px long, 28° off the shaft. Screen pixels in and out.
 */
export const arrowHead = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
): [number, number, number, number] => {
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const spread = (28 * Math.PI) / 180
  return [
    x1 - size * Math.cos(angle - spread),
    y1 - size * Math.sin(angle - spread),
    x1 - size * Math.cos(angle + spread),
    y1 - size * Math.sin(angle + spread),
  ]
}
