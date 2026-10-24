import React from "react"
import { StyleSheet, Text } from "react-native"

import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import {
  PT_STATUS_LABEL,
  ptStatusTone,
  type PtDisplayStatus,
} from "./personal-training-helpers"

// The request's status as a small tinted tag.
export function PtStatusPill({ status }: { status: PtDisplayStatus }) {
  const styles = useThemedStyles(makeStyles)
  const tone = ptStatusTone(status)
  return (
    <Text style={[styles.pill, styles[tone]]}>{PT_STATUS_LABEL[status]}</Text>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pill: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      fontSize: 11,
      fontWeight: "700",
      overflow: "hidden",
    },
    warning: {
      backgroundColor: theme.colors.warningSoft,
      color: theme.colors.warning,
    },
    accent: {
      backgroundColor: theme.colors.accentSoft,
      color: theme.colors.accent,
    },
    success: {
      backgroundColor: theme.colors.successSoft,
      color: theme.colors.success,
    },
    danger: {
      backgroundColor: theme.colors.dangerSoft,
      color: theme.colors.danger,
    },
    muted: {
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.muted,
    },
  })
