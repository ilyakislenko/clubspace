import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { AgendaItem } from "../../shared/api/agenda"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import {
  agendaCancelledText,
  agendaKindLabel,
  agendaTimeLabel,
} from "./agenda-helpers"

/**
 * One class / event / guest visit / personal session of the cross-club
 * agenda: the time on the club's clock, the club as a chip, a cancelled one
 * struck through with its reason. Shared by the Home card and the week screen.
 */
export function AgendaItemRow({
  item,
  onPress,
  last,
}: {
  item: AgendaItem
  onPress: () => void
  last?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const time = agendaTimeLabel(item)
  const cancelled = agendaCancelledText(item)
  const coach = item.myRole === "coach"
  const meta = [agendaKindLabel(item.kind), item.subtitle]
    .filter(Boolean)
    .join(" · ")

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        time,
        item.title,
        meta,
        item.workspaceName,
        coach ? "вы тренер" : null,
        cancelled,
      ]
        .filter(Boolean)
        .join(", ")}
      style={[styles.row, last && styles.rowLast]}
    >
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text
            style={[styles.time, item.cancelled && styles.struck]}
            numberOfLines={1}
          >
            {time}
          </Text>
          <View style={styles.chips}>
            {coach && (
              <Text style={[styles.chip, styles.coachChip]}>Вы тренер</Text>
            )}
            <Text style={styles.chip} numberOfLines={1}>
              {item.workspaceName}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.title, item.cancelled && styles.struck]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {cancelled && <Text style={styles.cancelled}>{cancelled}</Text>}
      </View>
      <Chevron style={styles.chev} />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    body: { flex: 1, gap: 2 },
    topLine: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(2),
    },
    time: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
    chips: {
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
    },
    chip: {
      flexShrink: 1,
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      overflow: "hidden",
    },
    coachChip: {
      flexShrink: 0,
      backgroundColor: theme.colors.accentSoft,
      color: theme.colors.accent,
    },
    title: { ...theme.typography.bodyStrong, color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted },
    struck: {
      textDecorationLine: "line-through",
      color: theme.colors.muted,
    },
    cancelled: { fontSize: 13, color: theme.colors.danger },
    chev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
  })
