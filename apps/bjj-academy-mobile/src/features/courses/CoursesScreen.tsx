import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { listCourses, type CourseSummary } from "../../shared/api/courses"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Courses">

export function CoursesScreen({ navigation }: Props) {
  const { workspace } = useAuth()
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(handle)
  }, [query])

  const load = useCallback(async () => {
    if (!workspace) return
    setError(null)
    try {
      const response = await listCourses({
        workspaceId: workspace.workspaceId,
        perPage: 100,
        q: debouncedQuery || undefined,
      })
      setCourses(response.data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить курсы.",
      )
    }
  }, [workspace, debouncedQuery])

  useEffect(() => {
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{workspace?.name}</Text>
          <Text style={styles.headerSubtitle}>Курсы</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate("Profile")}
          hitSlop={8}
        >
          <Text style={styles.signOut}>Профиль</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск курса..."
          placeholderTextColor={theme.colors.muted}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={onRefresh} style={styles.retryButton}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>
                Курсов пока нет. Загляните позже.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate("CourseDetail", {
                  courseId: item.id,
                  title: item.title,
                })
              }
              style={({ pressed }) => [
                styles.card,
                pressed && styles.cardPressed,
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
                  <Text style={styles.thumbPlaceholder}>Нет превью</Text>
                )}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.description && (
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
  headerSubtitle: { fontSize: 12, color: theme.colors.muted },
  signOut: { color: theme.colors.muted, fontSize: 14 },
  searchWrap: {
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(3),
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(3),
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  list: { padding: theme.spacing(4), gap: theme.spacing(3) },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(6),
    gap: theme.spacing(3),
  },
  card: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing(3),
  },
  cardPressed: { opacity: 0.85 },
  thumb: {
    width: 120,
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: { fontSize: 11, color: theme.colors.muted },
  cardBody: { flex: 1, padding: theme.spacing(3), gap: theme.spacing(1) },
  cardTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
  cardDesc: { fontSize: 13, color: theme.colors.muted },
  muted: { color: theme.colors.muted, fontSize: 14 },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
  retryButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryText: { color: theme.colors.text, fontSize: 14 },
})
