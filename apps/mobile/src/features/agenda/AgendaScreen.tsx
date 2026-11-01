import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { fetchMyAgenda, type AgendaItem } from "../../shared/api/agenda"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  agendaCacheKey,
  agendaDayHeader,
  groupAgendaByDay,
  weekRange,
} from "./agenda-helpers"
import { AgendaItemRow } from "./AgendaItemRow"
import { useOpenAgendaItem } from "./use-open-agenda-item"

type Props = NativeStackScreenProps<RootStackParamList, "Agenda">

/** The week ahead across every club the member is in, grouped by day. */
export function AgendaScreen(_: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const open = useOpenAgendaItem()
  // Per render, and in the key: a screen left open past midnight moves on.
  const range = weekRange(new Date())
  const { from, to } = range
  const { data, error, loading, refreshing, stale, refetch } =
    useCachedResource<AgendaItem[]>(
      agendaCacheKey(range),
      useCallback(
        async () => (await fetchMyAgenda({ from, to })).items,
        [from, to],
      ),
    )

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const days = groupAgendaByDay(data ?? [])

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {stale && data ? <OfflineNotice /> : null}

          {error && !data ? (
            <ErrorRetry message={error} onRetry={refetch} />
          ) : days.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                На этой неделе тренировок нет
              </Text>
              <Text style={styles.emptyText}>
                Здесь появятся занятия, события и персональные тренировки из
                всех ваших клубов.
              </Text>
            </View>
          ) : (
            days.map((day) => (
              <View key={day.date} style={styles.day}>
                <Text style={styles.dayHeader} accessibilityRole="header">
                  {agendaDayHeader(day.date, from)}
                </Text>
                <View style={styles.card}>
                  {day.items.map((item, i) => (
                    <AgendaItemRow
                      key={item.id}
                      item={item}
                      onPress={() => open(item)}
                      last={i === day.items.length - 1}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(5) },
    day: { gap: theme.spacing(2) },
    dayHeader: {
      ...theme.typography.label,
      paddingHorizontal: theme.spacing(1),
    },
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(4),
      ...theme.shadows.sm,
    },
    empty: { alignItems: "center", gap: theme.spacing(2), paddingTop: theme.spacing(8) },
    emptyTitle: { ...theme.typography.subheading, color: theme.colors.text },
    emptyText: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
    },
  })
