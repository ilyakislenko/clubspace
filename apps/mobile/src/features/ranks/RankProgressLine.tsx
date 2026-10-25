import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { RankProgressEntry } from "../../shared/api/rank-progress"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { rankProgressLine } from "./rank-progress"

export function RankProgressLine({ entry }: { entry: RankProgressEntry }) {
  const styles = useThemedStyles(makeStyles)
  const line = rankProgressLine(entry)
  if (!line) return null
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{line.title}</Text>
      {line.caption ? <Text style={styles.caption}>{line.caption}</Text> : null}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    box: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 2,
    },
    title: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    caption: { color: theme.colors.muted, fontSize: 13 },
  })
