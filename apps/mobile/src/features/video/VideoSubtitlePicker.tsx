import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

type SubtitleTrack = { id: string; label: string }

type Props = {
  subtitles: SubtitleTrack[]
  activeId: string | null
  onSelect: (id: string | null) => void
}

export function VideoSubtitlePicker({ subtitles, activeId, onSelect }: Props) {
  const styles = useThemedStyles(makeStyles)
  if (subtitles.length === 0) return null

  return (
    <View style={styles.block}>
      <Text style={styles.noteLabel}>Субтитры</Text>
      <View style={styles.subtitleRow}>
        <Pressable
          onPress={() => onSelect(null)}
          style={[
            styles.subtitleChip,
            activeId === null && styles.subtitleChipActive,
          ]}
        >
          <Text
            style={[
              styles.subtitleChipText,
              activeId === null && styles.subtitleChipTextActive,
            ]}
          >
            Off
          </Text>
        </Pressable>
        {subtitles.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => onSelect(s.id)}
            style={[
              styles.subtitleChip,
              activeId === s.id && styles.subtitleChipActive,
            ]}
          >
            <Text
              style={[
                styles.subtitleChipText,
                activeId === s.id && styles.subtitleChipTextActive,
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  block: { gap: theme.spacing(2) },
  noteLabel: { ...theme.typography.label },
  subtitleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(1) + 2,
  },
  subtitleChip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  subtitleChipActive: { backgroundColor: theme.colors.accent },
  subtitleChipText: { color: theme.colors.text, fontSize: 13 },
  subtitleChipTextActive: { color: theme.colors.accentText, fontWeight: "600" },
})
