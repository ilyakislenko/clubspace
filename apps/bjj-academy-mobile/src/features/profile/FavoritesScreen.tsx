import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getVideo, listMyFavorites } from "../../shared/api/videos"
import { useAuth } from "../../shared/auth-context"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { useToast } from "../../shared/components/Toast"
import { haptics } from "../../shared/haptics"
import { theme } from "../../shared/theme"
import { getCachedVideo } from "../offline/offline-store"
import {
  listFavorites,
  syncFavoritesFromServer,
  toggleFavorite,
} from "./preferences-store"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Favorites">

// The favorites list only renders a thumbnail card, so it needs a minimal
// video shape — not the full video detail. Both sources (the denormalised
// favorites endpoint and a cached VideoDetail) provide a superset of these
// fields, so they assign cleanly.
type FavoriteVideoCard = {
  id: string
  title: string
  status: string
  duration?: number | null
  thumbnailUrl?: string | null
}

type FavoriteEntry = {
  videoId: string
  video: FavoriteVideoCard
  fromCache: boolean
}

export function FavoritesScreen({ navigation }: Props) {
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const [entries, setEntries] = useState<FavoriteEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    // Drain any pending offline toggles (and refresh the local cache)
    // before we render. This is the moment a user is most likely to
    // notice missing stars, so it's the right place to reconcile.
    if (workspace) {
      await syncFavoritesFromServer(workspace.workspaceId)
    }
    // Online path: one server call returns ids + denormalised video meta,
    // which is much cheaper than the previous N+1 getVideo loop. We only
    // fall through to per-id cached lookups if the server is unreachable.
    if (workspace) {
      try {
        const response = await listMyFavorites({
          workspaceId: workspace.workspaceId,
        })
        const list: FavoriteEntry[] = response.data
          .filter((entry) => entry.video !== null)
          .map((entry) => ({
            videoId: entry.videoId,
            video: {
              id: entry.video!.id,
              title: entry.video!.title,
              status: entry.video!.status,
              duration: entry.video!.duration,
              thumbnailUrl: entry.video!.thumbnailUrl,
            },
            fromCache: false,
          }))
        setEntries(list)
        setLoading(false)
        return
      } catch {
        /* network down — fall back to local cache below */
      }
    }

    const ids = await listFavorites()
    if (ids.length === 0) {
      setEntries([])
      setLoading(false)
      return
    }
    const results = await Promise.all(
      ids.map(async (id) => {
        if (workspace) {
          try {
            const v = await getVideo({
              workspaceId: workspace.workspaceId,
              videoId: id,
            })
            return { videoId: id, video: v, fromCache: false } as FavoriteEntry
          } catch {
            /* fall through to cache */
          }
        }
        const cached = await getCachedVideo(id)
        if (cached)
          return {
            videoId: id,
            video: cached.video,
            fromCache: true,
          } as FavoriteEntry
        return null
      }),
    )
    setEntries(results.filter((e): e is FavoriteEntry => Boolean(e)))
    setLoading(false)
  }, [workspace])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }, [refresh])

  const handleUnfavorite = async (videoId: string) => {
    await toggleFavorite(videoId)
    haptics.light()
    showToast("Убрано из избранного")
    // Drop it from the list straight away so the card doesn't linger while the
    // background refresh runs (otherwise the toast says "removed" but it's still
    // on screen). refresh() then reconciles with the server.
    setEntries((prev) => prev.filter((e) => e.videoId !== videoId))
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
            <Text style={styles.emptyTitle}>Пока нет избранного</Text>
            <Text style={styles.emptyHint}>
              Откройте видео и нажмите ★ — оно появится здесь.
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("Video", {
                videoId: item.videoId,
                title: item.video.title,
              })
            }
            onLongPress={() => handleUnfavorite(item.videoId)}
            accessibilityRole="button"
            accessibilityLabel={item.video.title}
            accessibilityHint="Открыть видео. Удержание — убрать из избранного."
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            {item.video.thumbnailUrl ? (
              <Image
                source={{ uri: item.video.thumbnailUrl }}
                style={styles.thumb}
              />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <PlayGlyph />
              </View>
            )}
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {item.video.title}
              </Text>
              {item.fromCache && (
                <Text style={styles.muted}>из загруженного</Text>
              )}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
