import React, { useEffect, useRef, useState } from "react"
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type TextLayoutEvent,
} from "react-native"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { matchOfflineResource } from "../offline/offline-media-cache"
import { containRect } from "./drawing-math"
import {
  nextSubtitleFontStep,
  SUBTITLE_FONT_STEPS,
  SUBTITLE_MAX_LINES,
  subtitleMaxWidth,
} from "./subtitle-layout"
import { findActiveCue, parseVtt, type Cue } from "./subtitle-vtt"

// How long the cue takes to slide clear of (or back down from) the controls.
const LIFT_MS = 180

type Props = {
  url: string
  getCurrentTime: () => number | undefined
  // The video track's pixel size, to keep cues inside the picture's width.
  getVideoSize: () => { width: number; height: number } | null
  // Height of the player controls covering the bottom (0 while hidden): the
  // cue rides above them.
  bottomInset: number
}

export function SubtitleOverlay({
  url,
  getCurrentTime,
  getVideoSize,
  bottomInset,
}: Props) {
  const styles = useThemedStyles(makeStyles)
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [active, setActive] = useState<Cue | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Font step for a cue at a width (`key`); `fitted` once its layout settled
  // (it stays invisible until then, so no four-line frame flashes up).
  const [fitState, setFit] = useState({
    key: "",
    step: 0,
    fitted: false,
    clamped: false,
  })
  const lift = useRef(new Animated.Value(bottomInset)).current

  useEffect(() => {
    Animated.timing(lift, {
      toValue: bottomInset,
      duration: LIFT_MS,
      useNativeDriver: true,
    }).start()
  }, [bottomInset, lift])

  useEffect(() => {
    let cancelled = false
    setCues(null)
    setActive(null)
    // A downloaded lesson (web) points its tracks at stored copies.
    void matchOfflineResource(url)
      .then((stored) => stored ?? fetch(url))
      .then((res) => {
        if (!res.ok) throw new Error(`subtitle fetch ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        setCues(parseVtt(text))
      })
      .catch(() => {
        if (cancelled) return
        setCues([])
      })
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    if (!cues || cues.length === 0) return
    const interval = setInterval(() => {
      const t = getCurrentTime()
      if (typeof t !== "number") return
      const next = findActiveCue(cues, t)
      setActive((prev) => (prev?.text === next?.text ? prev : next))
    }, 250)
    return () => clearInterval(interval)
  }, [cues, getCurrentTime])

  // Every new cue (or width) starts again from the full size.
  const pictureWidth = containRect(size, getVideoSize()).width
  const maxWidth = subtitleMaxWidth(pictureWidth)
  const fitKey = `${active?.text ?? ""}|${maxWidth}`
  const fit =
    fitState.key === fitKey
      ? fitState
      : { key: fitKey, step: 0, fitted: false, clamped: false }

  const onTextLayout = (e: TextLayoutEvent) => {
    if (fit.fitted) return
    const lines = e.nativeEvent.lines.length
    const next = nextSubtitleFontStep(lines, fit.step)
    setFit(
      next != null
        ? { key: fitKey, step: next, fitted: false, clamped: false }
        : // Still too long at the smallest size: cut to three lines.
          { key: fitKey, step: fit.step, fitted: true, clamped: lines > SUBTITLE_MAX_LINES },
    )
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        { transform: [{ translateY: Animated.multiply(lift, -1) }] },
      ]}
      pointerEvents="none"
      onLayout={(e) =>
        setSize({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
    >
      {active && maxWidth > 0 && (
        <View style={[styles.line, { maxWidth }]}>
          <Text
            key={`${fitKey}:${fit.step}`}
            style={[
              styles.text,
              { fontSize: SUBTITLE_FONT_STEPS[fit.step] },
              !fit.fitted && styles.measuring,
            ]}
            numberOfLines={fit.clamped ? SUBTITLE_MAX_LINES : undefined}
            onTextLayout={onTextLayout}
          >
            {active.text}
          </Text>
        </View>
      )}
    </Animated.View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    // Spans the player; the cue sits at its bottom, lifted over the controls.
    wrap: {
      ...StyleSheet.absoluteFill,
      justifyContent: "flex-end",
      alignItems: "center",
      paddingBottom: theme.spacing(3),
    },
    line: { alignItems: "center" },
    text: {
      backgroundColor: theme.colors.overlayStrong,
      color: theme.colors.onOverlay,
      paddingHorizontal: theme.spacing(2),
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.sm,
      textAlign: "center",
      overflow: "hidden",
    },
    measuring: { opacity: 0 },
  })
