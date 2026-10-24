import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import { listEvents, type ScheduleEvent } from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import type { DeltaItem, DeltaOp } from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Events">

const formatRangeInTz = (
  startIso: string,
  endIso: string,
  tz: string,
): string => {
  // Render in the event's OWN timezone — that's the wall-clock the
  // organiser typed and the same string everyone in the club should
  // see. Device locale doesn't enter the picture.
  const start = new Date(startIso)
  const end = new Date(endIso)
  const dateFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
  })
  const timeFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const sameDay = dayKeyFmt.format(start) === dayKeyFmt.format(end)
  if (sameDay) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${dateFmt.format(end)}, ${timeFmt.format(end)}`
}

export function EventsScreen({ navigation: _ }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const {
    data: events,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<ScheduleEvent[]>(
    workspace ? `events:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        (await listEvents({ workspaceId: workspace!.workspaceId })).data,
      [workspace],
    ),
    {
      // Live event add/edit/remove, kept sorted by start time (server order).
      onDelta: useCallback(
        (list: ScheduleEvent[] | null, op: DeltaOp, item: DeltaItem) => {
          const current = list ?? []
          if (op === "delete") return current.filter((e) => e.id !== item.id)
          const next =
            op === "update"
              ? current.map((e) =>
                  e.id === item.id ? (item as ScheduleEvent) : e,
                )
              : [
                  ...current.filter((e) => e.id !== item.id),
                  item as ScheduleEvent,
                ]
          return [...next].sort((a, b) => a.startAt.localeCompare(b.startAt))
        },
        [],
      ),
    },
  )

  if (!workspace) return null

  if (loading && !events) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
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
        <Text style={styles.subtitle}>
          Семинары, открытые тренировки и спец-классы. Можно заглянуть в другой
          зал, если есть желание.
        </Text>

        {stale && events ? <OfflineNotice /> : null}

        {error && !events ? (
          <ErrorRetry message={error} onRetry={refetch} />
        ) : events && events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Событий пока нет</Text>
            <Text style={styles.emptyText}>
              Когда тренер опубликует семинар или открытый ковёр — он
              появится здесь.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {events?.map((event) => (
              <View key={event.id} style={styles.card}>
                <Text style={styles.cardTitle}>{event.title}</Text>
                <Text style={styles.cardWhen}>
                  {formatRangeInTz(
                    event.startAt,
                    event.endAt,
                    event.timezone,
                  )}
                </Text>
                <Text style={styles.cardTz}>{event.timezone}</Text>
                {event.gym && (
                  <Text style={styles.cardWhere} numberOfLines={1}>
                    {event.gym.name} · {event.gym.address}
                  </Text>
                )}
                {event.coach && (
                  <Text style={styles.cardCoach} numberOfLines={1}>
                    Ведёт:{" "}
                    {[event.coach.firstname, event.coach.lastname]
                      .filter(Boolean)
                      .join(" ")
                      .trim() || event.coach.email}
                  </Text>
                )}
                {event.description && (
                  <Text style={styles.cardDescription}>
                    {event.description}
                  </Text>
                )}
                {event.link && (
                  <Pressable
                    onPress={() => void Linking.openURL(event.link!)}
                    style={styles.linkRow}
                  >
                    <Text style={styles.linkText} numberOfLines={1}>
                      {event.link}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(3),
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(6),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptyTitle: {
    ...theme.typography.bodyStrong,
    color: theme.colors.text,
    textAlign: "center",
  },
  emptyText: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  list: { gap: theme.spacing(2) },
  card: {
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  cardTitle: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  cardWhen: {
    color: theme.colors.text,
    fontSize: 13,
  },
  cardTz: {
    color: theme.colors.muted,
    fontSize: 11,
    fontFamily: undefined,
  },
  cardWhere: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cardCoach: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cardDescription: {
    color: theme.colors.text,
    fontSize: 13,
    marginTop: theme.spacing(1),
  },
  linkRow: {
    marginTop: theme.spacing(1),
  },
  linkText: {
    color: theme.colors.accent,
    fontSize: 12,
  },
})
