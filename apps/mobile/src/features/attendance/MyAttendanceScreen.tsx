import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"

import {
  getMyAttendance,
  type AttendanceSession,
  type MyAttendance,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "MyAttendance">

const PER_PAGE = 20

const formatDate = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
  }).format(new Date(iso))

export function MyAttendanceScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  // Pages after the first. The cached resource owns page 1 (so offline and
  // realtime refreshes keep working); a fresh page 1 drops these and the list
  // pages in again from the top.
  const [more, setMore] = useState<AttendanceSession[]>([])
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<MyAttendance>(
    workspace ? `attendance:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        await getMyAttendance({
          workspaceId: workspace!.workspaceId,
          curPage: 1,
          perPage: PER_PAGE,
        }),
      [workspace],
    ),
  )

  useEffect(() => {
    setMore([])
    setPage(1)
  }, [data])

  const sessions = data ? [...data.sessions, ...more] : []
  const hasMore = data ? sessions.length < data.rangeCount : false

  const loadMore = async () => {
    if (!workspace || !data || !hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await getMyAttendance({
        workspaceId: workspace.workspaceId,
        curPage: page + 1,
        perPage: PER_PAGE,
      })
      setMore((prev) => {
        const seen = new Set([...data.sessions, ...prev].map((s) => s.id))
        return [...prev, ...next.sessions.filter((s) => !seen.has(s.id))]
      })
      setPage(page + 1)
    } catch {
      // Keep what is on screen; the next scroll to the end retries.
    } finally {
      setLoadingMore(false)
    }
  }

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={theme.colors.accent}
          />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            {data && (
              <Text style={styles.subtitle}>
                Всего отмечено: {data.total}
              </Text>
            )}
            {data && data.rangeCount !== data.total && (
              <Text style={styles.subtitle}>
                За последние 30 дней: {data.rangeCount}
              </Text>
            )}
            {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

            {stale && data ? <OfflineNotice /> : null}
          </View>
        }
        renderItem={({ item: s }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{s.title}</Text>
            <Text style={styles.rowDate}>{formatDate(s.startAt, s.timezone)}</Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          data ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.empty}>Пока нет отметок о посещении.</Text>
              <Pressable
                onPress={() => navigation.navigate("CheckIn")}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonText}>Отметиться на тренировке</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              color={theme.colors.accent}
              style={styles.footer}
            />
          ) : null
        }
      />
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
    body: { padding: theme.spacing(5) },
    header: { gap: theme.spacing(1), marginBottom: theme.spacing(3) },
    subtitle: { ...theme.typography.body, color: theme.colors.muted },
    empty: { color: theme.colors.muted, fontSize: 13 },
    emptyBlock: { gap: theme.spacing(3) },
    separator: { height: theme.spacing(1) },
    footer: { marginTop: theme.spacing(3) },
    button: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
    },
    buttonText: {
      color: theme.colors.accentText,
      fontWeight: "700",
      fontSize: 16,
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    rowDate: { color: theme.colors.muted, fontSize: 12 },
  })
