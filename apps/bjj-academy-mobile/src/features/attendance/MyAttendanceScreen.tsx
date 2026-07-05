import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  getMyAttendance,
  type MyAttendance,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { errorMessage } from "../../shared/error-message"
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

  const [data, setData] = useState<MyAttendance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      setData(await getMyAttendance({ workspaceId: workspace.workspaceId }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить посещаемость"))
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

  if (!workspace) return null

  if (data === null && !error) {
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
        <View>
          <Text style={styles.title}>Моя посещаемость</Text>
          {data && (
            <Text style={styles.subtitle}>
              Всего отмечено: {data.total}
            </Text>
          )}
        </View>

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

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
