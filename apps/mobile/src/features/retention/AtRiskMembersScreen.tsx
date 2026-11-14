import React, { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  listAtRiskMembers,
  type AtRiskMember,
  type AtRiskReason,
} from "../../shared/api/retention"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { invalidateResource } from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { errorMessage } from "../../shared/error-message"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import { AtRiskMemberCard } from "./AtRiskMemberCard"
import {
  applyContact,
  AT_RISK_RESOURCE,
  callListKey,
  isStaffWorkspace,
  mergePages,
  REASON_LABEL,
  REASON_ORDER,
} from "./retention-helpers"

const PER_PAGE = 50

export function AtRiskMembersScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const vocabulary = useVocabulary()
  const scrollRef = useRef<ScrollViewInstance>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const [reason, setReason] = useState<AtRiskReason | null>(null)
  const [showSnoozed, setShowSnoozed] = useState(false)
  // Pages after the first («Показать ещё»), for the current view only.
  const [more, setMore] = useState<AtRiskMember[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  const workspaceId = workspace?.workspaceId
  const staff = isStaffWorkspace(workspace)
  // The same list as the admin page and the dashboard: the server scopes it
  // to the caller. Its own key, not an `attendance:` one, so a check-in
  // somewhere in the club doesn't refetch it.
  const key =
    workspaceId && staff ? callListKey(workspaceId, showSnoozed, reason) : null
  const list = useCachedResource(
    key,
    useCallback(
      async () =>
        await listAtRiskMembers({
          workspaceId: workspaceId!,
          snoozed: showSnoozed,
          reason: showSnoozed ? undefined : (reason ?? undefined),
          perPage: PER_PAGE,
        }),
      [workspaceId, showSnoozed, reason],
    ),
  )
  useEffect(() => {
    setMore([])
    setMoreError(null)
  }, [key])

  if (!workspace) return null

  if (!staff) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <Text style={styles.empty}>Этот раздел — для {vocabulary.coach.genPl} клуба.</Text>
      </SafeAreaView>
    )
  }

  const data = list.data
  const rows = data ? mergePages(data.data, more) : []
  const hasMore = !!data && rows.length < data.total

  const chips: { key: AtRiskReason | null; label: string; count: number }[] = [
    { key: null, label: "Все", count: data?.summary.total ?? 0 },
    ...REASON_ORDER.map((r) => ({
      key: r,
      label: REASON_LABEL[r],
      count: data?.summary[r] ?? 0,
    })),
  ]

  const loadMore = async () => {
    if (!data || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const res = await listAtRiskMembers({
        workspaceId: workspace.workspaceId,
        snoozed: showSnoozed,
        reason: showSnoozed ? undefined : (reason ?? undefined),
        page: Math.floor(rows.length / PER_PAGE) + 1,
        perPage: PER_PAGE,
      })
      setMore((prev) => [...prev, ...res.data])
    } catch (err) {
      setMoreError(errorMessage(err, "Не удалось загрузить ещё"))
    } finally {
      setLoadingMore(false)
    }
  }

  // Off this list at once; the home card and every other view refetch (the
  // server dropped its cached list when the contact was logged).
  const onContacted = (userId: string) => {
    list.mutate((prev) => applyContact(prev, userId))
    setMore((prev) => prev.filter((m) => m.userId !== userId))
    invalidateResource(AT_RISK_RESOURCE, workspace.workspaceId)
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={list.refreshing}
                onRefresh={list.refetch}
                tintColor={theme.colors.accent}
              />
            }
          >
            {list.stale && <OfflineNotice />}
            {list.error && (
              <ErrorRetry message={list.error} onRetry={list.refetch} />
            )}

            {data && !showSnoozed && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                keyboardShouldPersistTaps="handled"
              >
                {chips.map((c) => (
                  <Pressable
                    key={c.label}
                    onPress={() => setReason(c.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: reason === c.key }}
                    style={[styles.chip, reason === c.key && styles.chipOn]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        reason === c.key && styles.chipTextOn,
                      ]}
                    >
                      {c.label} · {c.count}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {data && rows.length > 0 && (
              <ResponsiveGrid>
                {rows.map((m) => (
                  <AtRiskMemberCard
                    key={m.userId}
                    member={m}
                    workspaceId={workspace.workspaceId}
                    onContacted={onContacted}
                  />
                ))}
              </ResponsiveGrid>
            )}

            {hasMore && (
              <Pressable
                onPress={() => void loadMore()}
                disabled={loadingMore}
                accessibilityRole="button"
                style={styles.toggle}
              >
                <Text style={styles.toggleText}>
                  {loadingMore ? "Загружаем…" : "Показать ещё"}
                </Text>
              </Pressable>
            )}
            {moreError && <Text style={styles.empty}>{moreError}</Text>}

            {data && rows.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.empty}>
                  {showSnoozed
                    ? "За две недели ни с кем не связывались."
                    : "Все ученики на связи. Список обновляется сам — загляните на следующей неделе."}
                </Text>
              </View>
            )}

            {data && (showSnoozed || data.summary.snoozed > 0) && (
              <Pressable
                onPress={() => setShowSnoozed((v) => !v)}
                accessibilityRole="button"
                style={styles.toggle}
              >
                <Text style={styles.toggleText}>
                  {showSnoozed
                    ? "Скрыть отработанных"
                    : `Показать отработанных (${data.summary.snoozed})`}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    chips: { gap: theme.spacing(2) },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
    },
    chipOn: { backgroundColor: theme.colors.accent },
    chipText: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
    chipTextOn: { color: theme.colors.accentText },
    emptyBox: { paddingVertical: theme.spacing(6) },
    empty: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
      padding: theme.spacing(5),
    },
    toggle: { alignSelf: "center", padding: theme.spacing(3) },
    toggleText: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
  })
