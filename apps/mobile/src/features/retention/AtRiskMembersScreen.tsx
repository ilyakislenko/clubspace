import React, { useCallback, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  listAtRiskMembers,
  type AtRiskContact,
  type AtRiskReason,
} from "../../shared/api/retention"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
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
  isStaffWorkspace,
  REASON_LABEL,
  REASON_ORDER,
  visibleEntries,
} from "./retention-helpers"

export function AtRiskMembersScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const [reason, setReason] = useState<AtRiskReason | null>(null)
  const [showSnoozed, setShowSnoozed] = useState(false)

  const workspaceId = workspace?.workspaceId
  const staff = isStaffWorkspace(workspace)
  // Its own key, not an `attendance:` one: Home keeps this resource mounted for
  // the app's lifetime, and an attendance invalidation would re-run the whole
  // engine on every check-in in the club.
  const list = useCachedResource(
    workspaceId && staff ? `atrisk:${workspaceId}:mine` : null,
    useCallback(
      async () =>
        await listAtRiskMembers({ workspaceId: workspaceId!, scope: "mine" }),
      [workspaceId],
    ),
  )

  if (!workspace) return null

  if (!staff) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <Text style={styles.empty}>Этот раздел — для тренеров клуба.</Text>
      </SafeAreaView>
    )
  }

  const data = list.data
  const rows = data ? visibleEntries(data, reason, showSnoozed) : []

  const chips: { key: AtRiskReason | null; label: string; count: number }[] = [
    { key: null, label: "Все", count: data?.summary.total ?? 0 },
    ...REASON_ORDER.map((r) => ({
      key: r,
      label: REASON_LABEL[r],
      count: data?.summary[r] ?? 0,
    })),
  ]

  const onContacted = (userId: string, contact: AtRiskContact) =>
    list.mutate((prev) => applyContact(prev, userId, contact))

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

            {data && (
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

            {data && rows.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.empty}>
                  Все ученики на связи. Список обновляется сам — загляните на
                  следующей неделе.
                </Text>
              </View>
            )}

            {data && data.summary.snoozed > 0 && (
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
