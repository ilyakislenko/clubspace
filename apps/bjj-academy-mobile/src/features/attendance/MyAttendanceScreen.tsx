import React, { useCallback } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import {
  getMyAttendance,
  type MyAttendance,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const formatDate = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
  }).format(new Date(iso))

export function MyAttendanceScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

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
        await getMyAttendance({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )

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
        <View>
          <Text style={styles.title}>Моя посещаемость</Text>
          {data && (
            <Text style={styles.subtitle}>
              Всего отмечено: {data.total}
            </Text>
          )}
        </View>

        {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && data ? <OfflineNotice /> : null}

        {data && data.sessions.length === 0 ? (
          <Text style={styles.empty}>Пока нет отметок о посещении.</Text>
        ) : (
          <View style={styles.rows}>
            {data?.sessions.map((s) => (
              <View key={s.id} style={styles.row}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Text style={styles.rowDate}>
                  {formatDate(s.startAt, s.timezone)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    subtitle: {
      ...theme.typography.body,
      color: theme.colors.muted,
      marginTop: theme.spacing(1),
    },
    empty: { color: theme.colors.muted, fontSize: 13 },
    rows: { gap: theme.spacing(1) },
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
