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
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"

import { getMyRanks, type MyRanks, type Promotion } from "../../shared/api/ranks"
import { useAuth } from "../../shared/auth-context"
import { Card } from "../../shared/Card"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatLevelWithStripes } from "./rank-format"

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

export function MyRanksScreen() {
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
  } = useCachedResource<MyRanks>(
    workspace ? `ranks:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyRanks({ workspaceId: workspace!.workspaceId }),
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

  const swatchColor = (color: string | null): string =>
    color ?? theme.colors.mutedFaint

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
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
        {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && data ? <OfflineNotice /> : null}

        {data && data.current.length === 0 && !error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Пока нет присвоенных рангов. Тренер отметит повышение, когда оно
              случится.
            </Text>
          </View>
        )}

        {data?.current.map((p: Promotion) => (
          <Card key={p.id} style={styles.card}>
            <Text style={styles.ladderName}>{p.ladderName}</Text>
            <View style={styles.levelRow}>
              <View
                style={[styles.swatch, { backgroundColor: swatchColor(p.color) }]}
              />
              <Text style={styles.levelName}>
                {formatLevelWithStripes(p.levelName, p.stripes)}
              </Text>
            </View>
            <Text style={styles.meta}>Получен {fmtDate(p.awardedAt)}</Text>
            {p.awardedByName ? (
              <Text style={styles.meta}>Присвоил: {p.awardedByName}</Text>
            ) : null}
            {p.note ? <Text style={styles.note}>{p.note}</Text> : null}
          </Card>
        ))}

        {data && data.history.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>История повышений</Text>
            <View style={styles.rows}>
              {data.history.map((p: Promotion) => (
                <Card key={p.id} style={styles.row}>
                  <View
                    style={[
                      styles.rowSwatch,
                      { backgroundColor: swatchColor(p.color) },
                    ]}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {formatLevelWithStripes(p.levelName, p.stripes)}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {p.ladderName} · {fmtDate(p.awardedAt)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
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
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    // Surface (bg / radius / border / shadow) comes from <Card>; keep layout.
    card: {
      padding: theme.spacing(4),
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
