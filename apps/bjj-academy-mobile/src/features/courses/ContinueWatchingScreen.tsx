import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import {
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  clearRecents,
  listRecents,
  type RecentEntry,
} from "../profile/preferences-store"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "ContinueWatching">

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d} дн назад`
  return new Date(iso).toLocaleDateString("ru-RU")
}

export function ContinueWatchingScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [entries, setEntries] = useState<RecentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    const list = await listRecents()
    setEntries(list)
    setLoading(false)
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const handleClear = async () => {
    await clearRecents()
    void refresh()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <View style={styles.skeletonThumb} />
            <View style={styles.skeletonText}>
              <View style={styles.skeletonLine} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            </View>
          </View>
        ))}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      {entries.length > 0 && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{entries.length} видео</Text>
          <Pressable onPress={handleClear} hitSlop={8}>
            <Text style={styles.clear}>Очистить</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={entries}
        keyExtractor={(e) => e.videoId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        contentContainerStyle={
          entries.length === 0 ? styles.emptyWrap : styles.list
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Пока пусто</Text>
            <Text style={styles.emptyHint}>
              Здесь появятся видео, которые вы недавно смотрели.
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("Video", {
                videoId: item.videoId,
                courseId: item.courseId,
                title: item.title,
              })
            }
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            {item.thumbnailUrl ? (
              <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <PlayGlyph />
              </View>
            )}
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.meta}>{formatRelative(item.watchedAt)}</Text>
            </View>
          </Pressable>
        )}
      />
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  headerTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  clear: { color: theme.colors.muted, fontSize: 13, fontWeight: "600" },
  list: { paddingVertical: theme.spacing(2) },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing(5),
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  rowPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  thumb: {
    width: 100,
    height: 60,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  muted: { fontSize: 12, color: theme.colors.muted },
  body: { flex: 1, gap: 3 },
  title: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  meta: { color: theme.colors.mutedFaint, fontSize: 12 },
  empty: {
    alignItems: "center",
    paddingHorizontal: theme.spacing(8),
  },
  emptyWrap: { flex: 1, justifyContent: "center" },
  emptyTitle: {
    ...theme.typography.heading,
    color: theme.colors.text,
    marginBottom: theme.spacing(2),
  },
  emptyHint: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  skeletonRow: {
    flexDirection: "row",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  skeletonThumb: {
    width: 100,
    height: 60,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
  },
  skeletonText: { flex: 1, gap: 8 },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceMuted,
  },
  skeletonLineShort: { width: "55%", height: 11 },
})
