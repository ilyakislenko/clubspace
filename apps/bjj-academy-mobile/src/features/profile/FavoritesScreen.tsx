import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getVideo, type VideoDetail } from "../../shared/api/videos"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import { getCachedVideo } from "../offline/offline-store"
import { listFavorites, toggleFavorite } from "./preferences-store"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Favorites">

type FavoriteEntry = {
  videoId: string
  video: VideoDetail
  fromCache: boolean
}

export function FavoritesScreen({ navigation }: Props) {
  const { workspace } = useAuth()
  const [entries, setEntries] = useState<FavoriteEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
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

  const handleUnfavorite = async (videoId: string) => {
    await toggleFavorite(videoId)
    void refresh()
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.videoId}
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
                <Text style={styles.muted}>HLS</Text>
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
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing(4),
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
  },
  rowPressed: { opacity: 0.7 },
  thumb: {
    width: 96,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  muted: { fontSize: 12, color: theme.colors.muted },
  body: { flex: 1, gap: 2 },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  empty: {
    alignItems: "center",
    paddingHorizontal: theme.spacing(6),
  },
  emptyWrap: { flex: 1, justifyContent: "center" },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: theme.spacing(2),
  },
  emptyHint: {
    fontSize: 13,
    color: theme.colors.muted,
    textAlign: "center",
    lineHeight: 18,
  },
})
