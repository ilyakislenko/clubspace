import React from "react"
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native"

import type { VideoSearchHighlight } from "../../shared/api/video-search"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { formatPosition } from "../video/format-position"
import { momentKindLabel, splitHighlight } from "./search-text"

// A moment in a lesson found by «Поиск по видео» or «Техники»: where it is,
// what's said or titled there, the matched words in bold.
export type FoundMoment = {
  atSec: number
  kind: "chapter" | "speech" | "speechRu"
  snippet: string
  highlight: VideoSearchHighlight | null
}

export function Highlighted({
  text,
  highlight,
  style,
  numberOfLines,
}: {
  text: string
  highlight: VideoSearchHighlight | null
  style: StyleProp<TextStyle>
  numberOfLines?: number
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {splitHighlight(text, highlight).map((part, i) => (
        <Text key={i} style={part.hit ? styles.hit : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  )
}

// «1:12 · …захват за рукав…» — tap opens the lesson at that moment.
export function MomentChip({
  moment,
  onPress,
}: {
  moment: FoundMoment
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const kind = momentKindLabel(moment.kind)
  const time = formatPosition(moment.atSec)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kind ? `${kind}, ` : ""}${time}: ${moment.snippet} — открыть видео с этого места`}
      style={({ pressed }) => [styles.moment, pressed && styles.pressed]}
    >
      <View style={styles.timeChip}>
        <Text style={styles.timeText}>{time}</Text>
      </View>
      <View style={styles.momentText}>
        {kind && <Text style={styles.kind}>{kind}</Text>}
        <Highlighted
          text={moment.snippet}
          highlight={moment.highlight}
          style={styles.snippet}
          numberOfLines={3}
        />
      </View>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    hit: { color: theme.colors.accent, fontWeight: "700" },
    pressed: { opacity: 0.85 },
    moment: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 4,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    momentText: { flex: 1, gap: 2, paddingTop: 3 },
    kind: { ...theme.typography.label },
    snippet: { fontSize: 14, color: theme.colors.text, lineHeight: 19 },
  })
