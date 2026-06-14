import React, { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { theme } from "../../shared/theme"
import { findActiveCue, parseVtt, type Cue } from "./subtitle-vtt"

type Props = {
  url: string
  getCurrentTime: () => number | undefined
}

export function SubtitleOverlay({ url, getCurrentTime }: Props) {
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [active, setActive] = useState<Cue | null>(null)

  useEffect(() => {
    let cancelled = false
    setCues(null)
    setActive(null)
    void fetch(url)
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

  if (!active) return null
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={styles.text}>{active.text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: theme.spacing(3),
    left: theme.spacing(3),
    right: theme.spacing(3),
    alignItems: "center",
  },
  text: {
    backgroundColor: theme.colors.overlayStrong,
    color: theme.colors.onOverlay,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
    borderRadius: theme.radius.sm,
    fontSize: 16,
    textAlign: "center",
    overflow: "hidden",
  },
})
