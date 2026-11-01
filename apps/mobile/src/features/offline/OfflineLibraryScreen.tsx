import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { showAlert } from "../../shared/alert"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"

import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatVideoDuration } from "../../shared/format-video-duration"
import {
  clearAllOffline,
  getOfflineRootSizeBytes,
  listOfflineEntries,
  offlineDownloadControls,
  removeOffline,
} from "./offline-store"
import { formatBytes } from "./offline-budget"
import { OfflineStorageNote } from "./OfflineStorageNote"
import { lostReasonMessage, type OfflineVideoEntry } from "./offline-types"
import { useFocusEffect } from "@react-navigation/native"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "OfflineLibrary">

// The line under the title: what state the stored copy is in.
const statusLine = (entry: OfflineVideoEntry): string | null => {
  switch (entry.status) {
    case "ready":
      return entry.accessExpiresAt
        ? `Без интернета — до ${new Date(entry.accessExpiresAt).toLocaleDateString("ru-RU")}`
        : null
    case "partial":
      return `${entry.active ? "Скачивается" : "На паузе"} · ${Math.round(entry.progress * 100)}% — откройте урок, чтобы продолжить`
    case "lost":
      return lostReasonMessage(entry.lostReason)
  }
}

export function OfflineLibraryScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [entries, setEntries] = useState<OfflineVideoEntry[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)

  const refresh = useCallback(async () => {
    // In order: listing settles each entry (an expired or evicted one frees
    // its files), and the size must count what's left after that.
    const list = await listOfflineEntries()
    const bytes = await getOfflineRootSizeBytes()
    setEntries(list)
    setTotalBytes(bytes)
    setLoading(false)
    setRefreshCount((n) => n + 1)
  }, [])

  // Web: running downloads move their row's percentage; one finishing
  // reloads the list (and the sizes).
  useEffect(() => {
    if (!offlineDownloadControls) return
    return offlineDownloadControls.subscribe((videoId, progress) => {
      if (!progress) {
        void refresh()
        return
      }
      if (progress.phase !== "video") return
      setEntries((prev) =>
        prev.map((e) =>
          e.videoId === videoId
            ? {
                ...e,
                status: "partial",
                active: true,
                progress: progress.done / Math.max(progress.total, 1),
              }
            : e,
        ),
      )
    })
  }, [refresh])

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

  const confirmRemove = (entry: OfflineVideoEntry) => {
    showAlert(
      "Удалить из загруженного?",
      entry.video.title,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            await removeOffline(entry.videoId)
            void refresh()
          },
        },
      ],
    )
  }

  const confirmClearAll = () => {
    showAlert(
      "Очистить всё загруженное?",
      `Будет освобождено ~${formatBytes(totalBytes)}.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Очистить",
          style: "destructive",
          onPress: async () => {
            await clearAllOffline()
            void refresh()
          },
        },
      ],
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.skeletonHeader} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <View style={styles.skeletonThumb} />
            <View style={styles.skeletonText}>
              <View style={styles.skeletonLine} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            </View>
          </View>
        ))}
        </CenteredColumn>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      <View style={styles.header}>
        <Text style={styles.headerSize}>
          Занято: {formatBytes(totalBytes)}
        </Text>
        {entries.length > 0 && (
          <Pressable onPress={confirmClearAll} hitSlop={8}>
            <Text style={styles.clearAll}>Очистить всё</Text>
          </Pressable>
        )}
      </View>
      <OfflineStorageNote refreshKey={refreshCount} />

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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Пока ничего не скачано</Text>
            <Text style={styles.emptyHint}>
              Откройте видео и нажмите «Скачать», чтобы посмотреть его без
              интернета.
            </Text>
          </View>
        }
        contentContainerStyle={
          entries.length === 0 ? styles.emptyWrap : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("Video", {
                videoId: item.videoId,
                courseId: item.course?.id,
                title: item.video.title,
              })
            }
            onLongPress={() => confirmRemove(item)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            {item.thumbnailLocalUri ? (
              <Image
                source={{ uri: item.thumbnailLocalUri }}
                style={styles.thumb}
              />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <PlayGlyph />
              </View>
            )}
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={2}>
                {item.video.title}
              </Text>
              {item.course && (
                <Text style={styles.muted} numberOfLines={1}>
                  {item.course.title}
                </Text>
              )}
              <View style={styles.metaRow}>
                {formatVideoDuration(item.video.duration) && (
                  <Text style={styles.metaItem}>
                    {formatVideoDuration(item.video.duration)}
                  </Text>
                )}
                {item.bytes ? (
                  <Text style={styles.metaItem}>{formatBytes(item.bytes)}</Text>
                ) : null}
                <Text style={styles.metaItem}>
                  {new Date(item.savedAt).toLocaleDateString("ru-RU")}
                </Text>
              </View>
              {statusLine(item) && (
                <Text
                  style={[
                    styles.muted,
                    item.status === "lost" && styles.lostText,
                  ]}
                >
                  {statusLine(item)}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => confirmRemove(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Удалить «${item.video.title}» из загруженного`}
            >
              <Text style={styles.removeText}>Удалить</Text>
            </Pressable>
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
  headerSize: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  clearAll: { color: theme.colors.danger, fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  rowPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing(5),
  },
  thumb: {
    width: 100,
    height: 60,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 3 },
  title: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  muted: { color: theme.colors.muted, fontSize: 12 },
  metaRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: 2,
  },
  metaItem: { color: theme.colors.mutedFaint, fontSize: 11 },
  lostText: { color: theme.colors.danger },
  removeText: { color: theme.colors.danger, fontSize: 13, fontWeight: "600" },
  empty: { alignItems: "center", paddingHorizontal: theme.spacing(8) },
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
  skeletonHeader: {
    height: 48,
    marginHorizontal: theme.spacing(5),
    marginTop: theme.spacing(3),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
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
