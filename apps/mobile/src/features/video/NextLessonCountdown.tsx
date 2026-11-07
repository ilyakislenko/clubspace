import React, { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import type { PlayerHandle } from "./player-types"

const COUNTDOWN_SEC = 5

type Props = {
  title: string
  player: PlayerHandle
  onCancel: () => void
  // Also called when the countdown runs out.
  onPlayNow: () => void
}

/**
 * «Следующий урок через N с» — shown over the picture when a lesson ends.
 * Starting playback again (replay, seeking back and pressing play) counts as
 * «Отмена»: the student chose to stay on this lesson.
 */
export function NextLessonCountdown({ title, player, onCancel, onPlayNow }: Props) {
  const styles = useThemedStyles(makeStyles)
  const [left, setLeft] = useState(COUNTDOWN_SEC)
  const latest = useRef({ onCancel, onPlayNow })
  latest.current = { onCancel, onPlayNow }

  useEffect(() => {
    const id = setInterval(() => {
      if (player.playing) {
        latest.current.onCancel()
        return
      }
      // Stops at 0, so the effect below fires onPlayNow exactly once.
      setLeft((n) => Math.max(n - 1, 0))
    }, 1000)
    return () => clearInterval(id)
  }, [player])

  useEffect(() => {
    if (left <= 0) latest.current.onPlayNow()
  }, [left])

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.label}>Следующий урок через {left} с</Text>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>Отмена</Text>
        </Pressable>
        <Pressable onPress={onPlayNow} style={styles.playNow}>
          <Text style={styles.playNowText}>Смотреть сейчас</Text>
        </Pressable>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      position: "absolute",
      top: theme.spacing(3),
      right: theme.spacing(3),
      maxWidth: 320,
      gap: theme.spacing(2),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.overlayStrong,
    },
    label: { fontSize: 13, color: theme.colors.onOverlay, opacity: 0.85 },
    title: { fontSize: 16, fontWeight: "700", color: theme.colors.onOverlay },
    actions: { flexDirection: "row", gap: theme.spacing(2) },
    cancel: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
    },
    cancelText: { color: theme.colors.onOverlay, fontWeight: "600", fontSize: 14 },
    playNow: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    playNowText: { color: theme.colors.accentText, fontWeight: "700", fontSize: 14 },
  })
