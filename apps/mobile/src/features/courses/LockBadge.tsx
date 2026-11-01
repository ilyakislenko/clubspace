import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

// «🔒 Доступно с уровня «Синий пояс»» — the server's Russian reason for a
// locked course or lesson (rank/plan teaser, locked progression).
export function LockBadge({ reason }: { reason: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.badge}>
      <Text style={styles.text} numberOfLines={2}>
        🔒 {reason}
      </Text>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.warningSoft,
    marginTop: 4,
  },
  text: { fontSize: 11, fontWeight: "700", color: theme.colors.warning },
})
