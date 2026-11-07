import React from "react"
import { StyleSheet, Text } from "react-native"

import type { AtRiskSummary } from "../../shared/api/retention"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { HomeCard } from "../home/HomeCards"
import { callListReason, callListTitle } from "./retention-helpers"

/**
 * Home card for staff: how many students to call and the main reason; the
 * breakdown is on «Кому позвонить».
 */
export function CallListCard({
  summary,
  onPress,
  grow,
}: {
  summary: AtRiskSummary
  onPress: () => void
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const title = callListTitle(summary.total)
  const reason = callListReason(summary)
  return (
    <HomeCard
      onPress={onPress}
      accessibilityLabel={reason ? `${title}, ${reason}` : title}
      grow={grow}
    >
      <Text style={styles.title}>{title}</Text>
      {reason && <Text style={styles.reason}>{reason}</Text>}
    </HomeCard>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    title: { ...theme.typography.bodyStrong, color: theme.colors.text },
    reason: { ...theme.typography.caption, color: theme.colors.muted },
  })
