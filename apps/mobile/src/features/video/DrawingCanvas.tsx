// Renders a bookmark drawing (frame coordinates, see drawing-math) over the
// picture's rect — the paused-frame overlay, the editor's live strokes and the
// tiny preview in bookmark rows all draw through here.
import React from "react"
import { StyleSheet, View } from "react-native"
import Svg, { Ellipse, Path } from "react-native-svg"

import type { DrawingStroke } from "../../shared/api/video-study"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { arrowHead, toScreen, type Rect } from "./drawing-math"

// The palette keys the server accepts, in toolbar order.
export const DRAWING_COLORS: readonly DrawingStroke["color"][] = [
  "red",
  "yellow",
  "green",
  "white",
]

// Palette keys → theme tokens: the semantic colors read as plain red/yellow/
// green in every theme, and the overlay ink is white on the dark player.
export const drawingColor = (
  theme: Theme,
  key: DrawingStroke["color"],
): string =>
  ({
    red: theme.colors.danger,
    yellow: theme.colors.warning,
    green: theme.colors.success,
    white: theme.colors.onOverlay,
  })[key]

// Stroke widths (px) at full size; the preview scales them down.
const STROKE_WIDTH = 4
const ARROW_HEAD = 18

const strokePath = (
  stroke: DrawingStroke,
  rect: Rect,
  mirrored: boolean,
  headSize: number,
): string => {
  const p = stroke.points
  const at = (i: number) => toScreen(p[i], p[i + 1], rect, mirrored)
  const [x0, y0] = at(0)
  if (stroke.tool === "pen") {
    let d = `M${x0} ${y0}`
    for (let i = 2; i + 1 < p.length; i += 2) {
      const [x, y] = at(i)
      d += ` L${x} ${y}`
    }
    return d
  }
  // An arrow: the shaft, then both barbs from the tip.
  const [x1, y1] = at(2)
  const [ax, ay, bx, by] = arrowHead(x0, y0, x1, y1, headSize)
  return `M${x0} ${y0} L${x1} ${y1} M${ax} ${ay} L${x1} ${y1} L${bx} ${by}`
}

function StrokeShape({
  stroke,
  rect,
  mirrored,
  color,
  width,
  headSize,
}: {
  stroke: DrawingStroke
  rect: Rect
  mirrored: boolean
  color: string
  width: number
  headSize: number
}) {
  if (stroke.tool === "ellipse") {
    const [x0, y0] = toScreen(stroke.points[0], stroke.points[1], rect, mirrored)
    const [x1, y1] = toScreen(stroke.points[2], stroke.points[3], rect, mirrored)
    return (
      <Ellipse
        cx={(x0 + x1) / 2}
        cy={(y0 + y1) / 2}
        rx={Math.abs(x1 - x0) / 2}
        ry={Math.abs(y1 - y0) / 2}
        stroke={color}
        strokeWidth={width}
        fill="none"
      />
    )
  }
  return (
    <Path
      d={strokePath(stroke, rect, mirrored, headSize)}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  )
}

type Props = {
  strokes: readonly DrawingStroke[]
  // Where the picture sits in the parent (container pixels).
  rect: Rect
  mirrored: boolean
  // 1 = full size; the row preview passes a fraction.
  scale?: number
}

/** The strokes, each over a dark halo so they read on any frame. */
export function DrawingCanvas({ strokes, rect, mirrored, scale = 1 }: Props) {
  const theme = useTheme()
  const width = STROKE_WIDTH * scale
  const headSize = ARROW_HEAD * scale
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {strokes.map((stroke, i) => (
        <React.Fragment key={i}>
          <StrokeShape
            stroke={stroke}
            rect={rect}
            mirrored={mirrored}
            color={theme.colors.overlayStrong}
            width={width + 3 * scale}
            headSize={headSize}
          />
          <StrokeShape
            stroke={stroke}
            rect={rect}
            mirrored={mirrored}
            color={drawingColor(theme, stroke.color)}
            width={width}
            headSize={headSize}
          />
        </React.Fragment>
      ))}
    </Svg>
  )
}

// The row preview: a 16:9 dark tile with the drawing scaled into it.
const THUMB_WIDTH = 48
const THUMB_HEIGHT = 27

/** A tiny preview of a bookmark's drawing for list rows. */
export function DrawingThumb({ strokes }: { strokes: readonly DrawingStroke[] }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.thumb} pointerEvents="none">
      <DrawingCanvas
        strokes={strokes}
        rect={{ x: 0, y: 0, width: THUMB_WIDTH, height: THUMB_HEIGHT }}
        mirrored={false}
        scale={0.3}
      />
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    thumb: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      borderRadius: theme.radius.sm,
      overflow: "hidden",
      backgroundColor: theme.colors.playerBg,
    },
  })
