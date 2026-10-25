import React from "react"
import { StyleSheet, Text } from "react-native"

import type { AtRiskSummary } from "../../shared/api/retention"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { HomeCard } from "../home/HomeCards"
import { callListBody, callListTitle } from "./retention-helpers"

/** Home card for staff: how many students to call, and why. */
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
  return (
    <HomeCard
      title={title}
      onPress={onPress}
      accessibilityLabel={title}
      grow={grow}
    >
      <Text style={styles.body}>{callListBody(summary)}</Text>
    </HomeCard>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { ...theme.typography.body, color: theme.colors.muted },
  })
