import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useState } from "react"
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

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "CourseDetail">

const formatDuration = (seconds?: number | null): string | null => {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, "0")}`
}

export function CourseDetailScreen({ route, navigation }: Props) {
  const { courseId } = route.params
  const { workspace } = useAuth()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const data = await getCourse({
          workspaceId: workspace.workspaceId,
          courseId,
        })
        if (cancelled) return
        setCourse(data)
        navigation.setOptions({ title: data.title })
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить курс.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [courseId, navigation, workspace])

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  if (error || !course) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>{error ?? "Курс не найден."}</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <FlatList
        data={course.videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{course.title}</Text>
            {course.description ? (
              <Text style={styles.description}>{course.description}</Text>
            ) : null}
            <Text style={styles.muted}>
              Уроков: {course.videos.length}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>В этом курсе пока нет видео.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const ready = item.status === "ready"
          const duration = formatDuration(item.duration)
          return (
            <Pressable
              onPress={() => {
                if (!ready) return
                navigation.navigate("Video", {
                  videoId: item.id,
                  courseId: course.id,
                  title: item.title,
                })
              }}
              disabled={!ready}
              style={({ pressed }) => [
                styles.row,
                !ready && styles.rowDisabled,
                pressed && ready && styles.rowPressed,
              ]}
            >
              <View style={styles.thumb}>
                {item.thumbnailUrl ? (
                  <Image
                    source={{ uri: item.thumbnailUrl }}
                    style={styles.thumbImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.thumbPlaceholder}>№{index + 1}</Text>
                )}
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.rowMeta}>
                  Урок {index + 1}
                  {duration ? ` · ${duration}` : ""}
                  {!ready ? " · в обработке" : ""}
                </Text>
              </View>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: theme.spacing(4), gap: theme.spacing(2) },
  header: { gap: theme.spacing(2), marginBottom: theme.spacing(3) },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.text },
  description: { fontSize: 14, color: theme.colors.muted, lineHeight: 20 },
  muted: { fontSize: 12, color: theme.colors.muted },
  row: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    marginBottom: theme.spacing(2),
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowDisabled: { opacity: 0.6 },
  rowPressed: { opacity: 0.85 },
  thumb: {
    width: 96,
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.muted,
  },
  rowBody: { flex: 1, padding: theme.spacing(3), justifyContent: "center" },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: theme.spacing(1),
  },
  rowMeta: { fontSize: 12, color: theme.colors.muted },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
})
