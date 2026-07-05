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

import { getMyRanks, type MyRanks, type Promotion } from "../../shared/api/ranks"
import { useAuth } from "../../shared/auth-context"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

const stripeLabel = (n: number): string =>
  n === 0 ? "" : ` · ${n} ${n === 1 ? "полоса" : n < 5 ? "полосы" : "полос"}`

export function MyRanksScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const [data, setData] = useState<MyRanks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      setData(await getMyRanks({ workspaceId: workspace.workspaceId }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить ранги"))
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

  const swatchColor = (color: string | null): string =>
    color ?? theme.colors.mutedFaint

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
        <Text style={styles.title}>Мой ранг</Text>

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

        {data && data.current.length === 0 && !error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Пока нет присвоенных рангов. Тренер отметит повышение, когда оно
              случится.
            </Text>
          </View>
        )}

        {data?.current.map((p: Promotion) => (
          <View key={p.id} style={styles.card}>
            <Text style={styles.ladderName}>{p.ladderName}</Text>
            <View style={styles.levelRow}>
              <View
                style={[styles.swatch, { backgroundColor: swatchColor(p.color) }]}
              />
              <Text style={styles.levelName}>
                {p.levelName}
                {stripeLabel(p.stripes)}
              </Text>
            </View>
            <Text style={styles.meta}>Получен {fmtDate(p.awardedAt)}</Text>
            {p.note ? <Text style={styles.note}>{p.note}</Text> : null}
          </View>
        ))}

        {data && data.history.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>История повышений</Text>
            <View style={styles.rows}>
              {data.history.map((p: Promotion) => (
                <View key={p.id} style={styles.row}>
                  <View
                    style={[
                      styles.rowSwatch,
                      { backgroundColor: swatchColor(p.color) },
                    ]}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {p.levelName}
                      {stripeLabel(p.stripes)}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {p.ladderName} · {fmtDate(p.awardedAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
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
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 6,
    },
    ladderName: {
      ...theme.typography.label,
      color: theme.colors.muted,
    },
    levelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    swatch: {
      width: 18,
      height: 18,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    levelName: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
    meta: { color: theme.colors.muted, fontSize: 13 },
    note: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontStyle: "italic",
    },
    sectionTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
      marginBottom: theme.spacing(1),
    },
    rows: { gap: theme.spacing(1) },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowSwatch: {
      width: 12,
      height: 12,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    rowMeta: { color: theme.colors.muted, fontSize: 12 },
  })
