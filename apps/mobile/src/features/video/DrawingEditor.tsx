// «Рисовать»: marking up the paused frame — pen, arrow, ellipse in a few
// colors, with undo/clear — then «Сохранить» onto a bookmark at this moment.
// It covers the whole player and takes every touch, so the player's own
// gestures (tap, double tap, hold for 2x) are off while it is open. Strokes
// are kept in frame coordinates (drawing-math), so the picture's letterbox
// and mirror never skew them.
import React, { useRef, useState } from "react"
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native"
import type { EdgeInsets } from "react-native-safe-area-context"

import type { BookmarkDrawing, DrawingStroke } from "../../shared/api/video-study"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { DRAWING_COLORS, DrawingCanvas, drawingColor } from "./DrawingCanvas"
import { canAddStroke, finishStroke, toFrame, type Rect } from "./drawing-math"

type Tool = DrawingStroke["tool"]

const TOOLS: { tool: Tool; icon: React.ComponentProps<typeof Icon>["name"]; label: string }[] =
  [
    { tool: "pen", icon: "brush", label: "Карандаш" },
    { tool: "arrow", icon: "arrow-forward", label: "Стрелка" },
    { tool: "ellipse", icon: "ellipse-outline", label: "Овал" },
  ]

const COLOR_LABELS: Record<DrawingStroke["color"], string> = {
  red: "Красный",
  yellow: "Жёлтый",
  green: "Зелёный",
  white: "Белый",
}

type Props = {
  // The picture's rect inside the player (container pixels).
  rect: Rect
  mirrored: boolean
  // Edit an existing drawing (the one shown at this moment) or start blank.
  initialStrokes: readonly DrawingStroke[]
  insets: EdgeInsets
  // null = every stroke of an existing drawing was cleared: remove it.
  onSave: (drawing: BookmarkDrawing | null) => void
  onCancel: () => void
}

export function DrawingEditor({
  rect,
  mirrored,
  initialStrokes,
  insets,
  onSave,
  onCancel,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()
  const [strokes, setStrokes] = useState<DrawingStroke[]>(() => [...initialStrokes])
  const [tool, setTool] = useState<Tool>("arrow")
  const [color, setColor] = useState<DrawingStroke["color"]>("red")
  // The stroke under the finger: frame coordinates, flat. The ref is what the
  // release reads (a move's re-render may not have landed yet); the state
  // paints it.
  const trackRef = useRef<number[]>([])
  const [track, setTrackState] = useState<number[]>([])
  const setTrack = (next: number[]) => {
    trackRef.current = next
    setTrackState(next)
  }
  // Touch-down position (container-relative and page) plus the finger's
  // travel since — `locationX` isn't reliable during a move on every platform.
  const origin = useRef({ x: 0, y: 0, pageX: 0, pageY: 0 })

  const at = (e: GestureResponderEvent) =>
    toFrame(
      origin.current.x + e.nativeEvent.pageX - origin.current.pageX,
      origin.current.y + e.nativeEvent.pageY - origin.current.pageY,
      rect,
      mirrored,
    )

  const finish = () => {
    const stroke = finishStroke(tool, color, trackRef.current)
    setTrack([])
    if (!stroke) return
    if (!canAddStroke(strokes, stroke)) {
      showToast("Рисунок слишком большой — отмените или очистите часть")
      return
    }
    setStrokes((list) => [...list, stroke])
  }

  const live = finishStroke(tool, color, track)
  const canSave = strokes.length > 0 || initialStrokes.length > 0

  return (
    <View style={StyleSheet.absoluteFill}>
      <View
        style={StyleSheet.absoluteFill}
        collapsable={false}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          const { locationX, locationY, pageX, pageY } = e.nativeEvent
          origin.current = { x: locationX, y: locationY, pageX, pageY }
          setTrack(at(e))
        }}
        onResponderMove={(e) => {
          const [x, y] = at(e)
          const t = trackRef.current
          setTrack(tool === "pen" ? [...t, x, y] : [t[0] ?? x, t[1] ?? y, x, y])
        }}
        onResponderRelease={finish}
        onResponderTerminate={() => setTrack([])}
      >
        <DrawingCanvas
          strokes={live ? [...strokes, live] : strokes}
          rect={rect}
          mirrored={mirrored}
        />
      </View>

      <View
        style={[
          styles.toolbar,
          {
            paddingBottom: theme.spacing(2) + insets.bottom,
            paddingLeft: theme.spacing(3) + insets.left,
            paddingRight: theme.spacing(3) + insets.right,
          },
        ]}
      >
        {TOOLS.map((t) => (
          <Pressable
            key={t.tool}
            onPress={() => setTool(t.tool)}
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tool === t.tool }}
            hitSlop={4}
            style={[styles.toolButton, tool === t.tool && styles.active]}
          >
            <Icon
              name={t.icon}
              size={20}
              color={tool === t.tool ? theme.colors.accentText : theme.colors.onOverlay}
            />
          </Pressable>
        ))}
        <View style={styles.divider} />
        {DRAWING_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            accessibilityLabel={COLOR_LABELS[c]}
            accessibilityState={{ selected: color === c }}
            hitSlop={4}
            style={[styles.swatchRing, color === c && styles.swatchRingActive]}
          >
            <View
              style={[styles.swatch, { backgroundColor: drawingColor(theme, c) }]}
            />
          </Pressable>
        ))}
        <View style={styles.divider} />
        <Pressable
          onPress={() => setStrokes((list) => list.slice(0, -1))}
          disabled={strokes.length === 0}
          accessibilityLabel="Отменить последний штрих"
          hitSlop={4}
          style={[styles.toolButton, strokes.length === 0 && styles.disabled]}
        >
          <Icon name="arrow-undo" size={20} color={theme.colors.onOverlay} />
        </Pressable>
        <Pressable
          onPress={() => setStrokes([])}
          disabled={strokes.length === 0}
          accessibilityLabel="Очистить рисунок"
          hitSlop={4}
          style={[styles.toolButton, strokes.length === 0 && styles.disabled]}
        >
          <Icon name="trash-outline" size={20} color={theme.colors.onOverlay} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable onPress={onCancel} hitSlop={4} style={styles.chip}>
          <Text style={styles.chipText}>Отмена</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(strokes.length > 0 ? { strokes } : null)}
          disabled={!canSave}
          accessibilityLabel="Сохранить рисунок в закладку"
          hitSlop={4}
          style={[styles.chip, styles.active, !canSave && styles.disabled]}
        >
          <Text style={[styles.chipText, styles.activeText]}>Сохранить</Text>
        </Pressable>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    toolbar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingTop: theme.spacing(2),
      backgroundColor: theme.colors.overlayStrong,
    },
    toolButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    active: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    activeText: { color: theme.colors.accentText },
    disabled: { opacity: 0.4 },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: 24,
      backgroundColor: theme.colors.onOverlay,
      opacity: 0.4,
    },
    swatchRing: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: "transparent",
    },
    swatchRingActive: { borderColor: theme.colors.onOverlay },
    swatch: { width: 20, height: 20, borderRadius: 10 },
    spacer: { flex: 1 },
    chip: {
      minHeight: 32,
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontWeight: "700",
    },
  })
