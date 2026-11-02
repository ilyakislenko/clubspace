import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import type { AgendaItem } from "../../shared/api/agenda"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { HomeCard } from "../home/HomeCards"
import { AgendaItemRow } from "./AgendaItemRow"

/** Home, for a member of several clubs: today's classes across all of them. */
export function AgendaTodayCard({
  items,
  error,
  onRetry,
  onOpen,
  onWeek,
  grow,
}: {
  /** Null while the first load is in flight. */
  items: AgendaItem[] | null
  error: string | null
  onRetry: () => void
  onOpen: (item: AgendaItem) => void
  onWeek: () => void
  grow?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <HomeCard title="Сегодня во всех клубах" grow={grow}>
      {items ? (
        items.length === 0 ? (
          <Text style={styles.muted}>Сегодня ничего нет</Text>
        ) : (
          <View>
            {items.map((item, i) => (
              <AgendaItemRow
                key={item.id}
                item={item}
                onPress={() => onOpen(item)}
                last={i === items.length - 1}
              />
            ))}
          </View>
        )
      ) : error ? (
        <ErrorRetry message={error} onRetry={onRetry} />
      ) : (
        <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
      )}
      <Pressable
        onPress={onWeek}
        accessibilityRole="button"
        accessibilityLabel="Вся неделя во всех клубах"
        hitSlop={8}
        style={styles.weekLink}
      >
        <Text style={styles.weekLinkText}>Вся неделя</Text>
      </Pressable>
    </HomeCard>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    spinner: { alignSelf: "flex-start", marginVertical: theme.spacing(2) },
    weekLink: { alignSelf: "flex-start", marginTop: theme.spacing(1) },
    weekLinkText: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.accent,
    },
  })
