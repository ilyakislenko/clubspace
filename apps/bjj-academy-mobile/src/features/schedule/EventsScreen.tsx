import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { listEvents, type ScheduleEvent } from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Events">

const formatRange = (startIso: string, endIso: string): string => {
  // Render in device-local for now — workspace TZ is the canonical
  // anchor on the server, but listEvents doesn't return it. Most
  // students live in the gym's TZ, so the gap is negligible until the
  // multi-city case shows up.
  const start = new Date(startIso)
  const end = new Date(endIso)
  const sameDay = start.toDateString() === end.toDateString()
  const dateOpts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
  }
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  }
  if (sameDay) {
    return `${start.toLocaleDateString("ru-RU", dateOpts)}, ${start.toLocaleTimeString(
      "ru-RU",
      timeOpts,
    )} – ${end.toLocaleTimeString("ru-RU", timeOpts)}`
  }
  return `${start.toLocaleString("ru-RU", { ...dateOpts, ...timeOpts })} – ${end.toLocaleString(
    "ru-RU",
    { ...dateOpts, ...timeOpts },
  )}`
}

export function EventsScreen({ navigation: _ }: Props) {
  const { workspace } = useAuth()
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      const response = await listEvents({ workspaceId: workspace.workspaceId })
      setEvents(response.data)
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить ивенты",
      )
      setEvents([])
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  if (events === null && !error) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <Text style={styles.title}>Ивенты</Text>
        <Text style={styles.subtitle}>
          Семинары, открытые ковры и спец-классы. Можно заглянуть в другой
          зал, если есть желание.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        {events && events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ивентов пока нет</Text>
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
                  {formatRange(event.startAt, event.endAt)}
                </Text>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
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
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  error: { color: theme.colors.danger, fontSize: 13 },
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
