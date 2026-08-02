import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import {
  listNotifications,
  markNotificationsSeen,
  type NotificationItem,
} from "../../shared/api/notifications"
import {
  applyListOp,
  type DeltaItem,
  type DeltaOp,
} from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">

const relativeTime = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.round(diffMs / 60000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  })
}

const videoIdFrom = (item: NotificationItem): string | null => {
  const v = item.metadata?.["videoId"]
  return typeof v === "string" ? v : null
}

export function NotificationsScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles)

  const { data, error, loading, refreshing, stale, refetch } =
    useCachedResource<NotificationItem[]>(
      "notifications:me",
      useCallback(async () => (await listNotifications({ perPage: 50 })).data, []),
      {
        // A new notification is pushed straight into the open inbox (newest
        // first — applyListOp create prepends).
        onDelta: useCallback(
          (list: NotificationItem[] | null, op: DeltaOp, item: DeltaItem) =>
            applyListOp(list ?? [], op, item),
          [],
        ),
      },
    )
  const items = data ?? []

  // Acknowledge everything on open (and on a live push arriving while open) so
  // the unread badge clears. Local `seen` flags stay as fetched until the next
  // refetch, so freshly-read items still show a dot this viewing.
  useEffect(() => {
    if (data && data.some((n) => !n.seen)) void markNotificationsSeen()
  }, [data])

  const handlePress = useCallback(
    (item: NotificationItem) => {
      const videoId = videoIdFrom(item)
      if (videoId) navigation.navigate("Video", { videoId })
    },
    [navigation],
  )

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={styles.spinner.color as string} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refetch} />
        }
        contentContainerStyle={
          items.length === 0 ? styles.emptyContent : styles.listContent
        }
        ListHeaderComponent={stale && data ? <OfflineNotice /> : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Пока пусто</Text>
            <Text style={styles.emptyText}>
              {error ??
                "Уведомления о тренировках, событиях и новых видео появятся здесь."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const tappable = videoIdFrom(item) !== null
          return (
            <Pressable
              onPress={() => handlePress(item)}
              disabled={!tappable}
              style={styles.row}
              accessibilityRole={tappable ? "button" : undefined}
            >
              <View style={styles.dotColumn}>
                {!item.seen ? <View style={styles.dot} /> : null}
              </View>
              <View style={styles.body}>
                <Text style={styles.topic} numberOfLines={2}>
                  {item.topic}
                </Text>
                <Text style={styles.message} numberOfLines={4}>
                  {item.message}
                </Text>
                <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
              </View>
              {tappable ? <Text style={styles.chev}>›</Text> : null}
            </Pressable>
          )
        }}
      />
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.surface },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface,
    },
    spinner: { color: theme.colors.accent },
    listContent: { padding: theme.spacing(3), gap: theme.spacing(2) },
    emptyContent: { flexGrow: 1, justifyContent: "center", padding: theme.spacing(6) },
    empty: { alignItems: "center", gap: theme.spacing(2) },
    emptyTitle: { ...theme.typography.label, fontSize: 16 },
    emptyText: {
      ...theme.typography.caption,
      textAlign: "center",
    },
    row: {
      flexDirection: "row",
      gap: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    dotColumn: { width: 10, paddingTop: 6, alignItems: "center" },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    body: { flex: 1, gap: 2 },
    topic: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
    message: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 19 },
    time: {
      fontSize: 12,
      color: theme.colors.mutedFaint,
      marginTop: theme.spacing(1),
    },
    chev: { fontSize: 22, color: theme.colors.mutedFaint, alignSelf: "center" },
  })
