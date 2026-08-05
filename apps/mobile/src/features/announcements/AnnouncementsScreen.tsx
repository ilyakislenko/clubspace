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
  getAnnouncementFeed,
  type Announcement,
} from "../../shared/api/announcements"
import { useAuth } from "../../shared/auth-context"
import {
  applyListOp,
  type DeltaItem,
  type DeltaOp,
} from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const PER_PAGE = 30

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

// Match the server feed order: pinned first, then newest.
const sortFeed = (list: Announcement[]): Announcement[] =>
  [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.publishedAt ?? b.createdAt).localeCompare(
      a.publishedAt ?? a.createdAt,
    )
  })

export function AnnouncementsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const {
    data: items,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<Announcement[]>(
    workspace ? `announcements:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        (
          await getAnnouncementFeed({
            workspaceId: workspace!.workspaceId,
            perPage: PER_PAGE,
          })
        ).data,
      [workspace],
    ),
    {
      // A coach publishing/editing/deleting an announcement pushes a delta —
      // patch the open feed in place instead of refetching.
      onDelta: useCallback(
        (data: Announcement[] | null, op: DeltaOp, item: DeltaItem) =>
          op === "delete"
            ? applyListOp(data ?? [], op, item)
            : sortFeed(applyListOp(data ?? [], op, item)),
        [],
      ),
    },
  )

  if (!workspace) return null

  if (loading && !items) {
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
        <Text style={styles.title}>Анонсы</Text>

        {error && !items && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && items ? <OfflineNotice /> : null}

        {items && items.length === 0 && !error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Пока нет анонсов.</Text>
          </View>
        )}

        {items?.map((a: Announcement) => (
          <View key={a.id} style={styles.card}>
            {a.pinned && (
              <View style={styles.pinChip}>
                <Text style={styles.pinChipText}>📌 Закреплено</Text>
              </View>
            )}
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.cardBody}>{a.body}</Text>
            <Text style={styles.cardMeta}>
              {a.authorName} · {fmtDate(a.publishedAt ?? a.createdAt)}
            </Text>
          </View>
        ))}
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
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { color: theme.colors.muted, fontSize: 14 },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 6,
    },
    pinChip: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
    },
    pinChipText: {
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    cardBody: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    cardMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  })
