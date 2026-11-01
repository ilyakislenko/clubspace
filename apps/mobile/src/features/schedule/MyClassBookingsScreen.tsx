import React, { useCallback, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { navigateToTab } from "../../app/navigation"
import {
  cancelClassBooking,
  getMyClassBookings,
  type ClassBooking,
  type MyClassBookings,
} from "../../shared/api/class-bookings"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  CLASS_BOOKING_STATUS_LABEL,
  burnLine,
  cancelPrompt,
  formatDeadline,
  isLateCancel,
} from "./class-booking-helpers"
import { formatSessionStart } from "./schedule-helpers"

const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s

/**
 * «Мои записи»: the member's places and waitlist places in booking-mode
 * classes, and the last weeks' history with late cancels, no-shows and the
 * classes they burned. For a guardian acting as a child it is the child's
 * (the client sends X-Act-As).
 */
export function MyClassBookingsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  // The booking being cancelled (one at a time).
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Same key as the schedule's; refreshed by the `classbookings`
  // invalidation (a promotion, a club cancel, the sweep).
  const { data, error, loading, refreshing, stale, refetch, mutate } =
    useCachedResource<MyClassBookings>(
      workspace ? `classbookings:${workspace.workspaceId}:mine` : null,
      useCallback(
        async () =>
          await getMyClassBookings({ workspaceId: workspace!.workspaceId }),
        [workspace],
      ),
    )

  if (!workspace) return null

  const now = Date.now()

  const cancel = async (b: ClassBooking) => {
    if (busyId) return
    setBusyId(b.id)
    setActionError(null)
    try {
      const result = await cancelClassBooking({
        workspaceId: workspace.workspaceId,
        bookingId: b.id,
      })
      haptics.success()
      const burned = burnLine(result)
      showToast(
        b.status === "WAITLISTED"
          ? "Вы покинули лист ожидания"
          : burned
            ? `Запись отменена. ${burned}`
            : "Запись отменена",
        "success",
      )
      mutate((prev) =>
        prev
          ? {
              upcoming: prev.upcoming.filter((u) => u.id !== result.id),
              history: [result, ...prev.history.filter((h) => h.id !== result.id)],
            }
          : prev,
      )
      refetch()
    } catch (e) {
      setActionError(errorMessage(e, "Не удалось отменить запись"))
    } finally {
      setBusyId(null)
    }
  }

  const confirmCancel = (b: ClassBooking) => {
    const prompt = cancelPrompt({
      status: b.status,
      late: isLateCancel(b, now, b.lateCancelNow),
      promoted: !!b.promotedAt,
      cancelDeadline: b.cancelDeadline,
      timezone: b.timezone,
      burns: b.lateCancelBurns,
    })
    showAlert(prompt.title, prompt.message, [
      { text: "Нет", style: "cancel" },
      {
        text: prompt.confirm,
        style: "destructive",
        onPress: () => void cancel(b),
      },
    ])
  }

  const upcoming = data?.upcoming ?? []
  const history = data?.history ?? []

  const classLines = (b: ClassBooking) => (
    <>
      <Text style={styles.when}>
        {capitalize(formatSessionStart(b.startAt, b.timezone))}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {[b.gym?.name ?? "Зал не указан", `тренер ${b.coachName}`].join(" · ")}
      </Text>
    </>
  )

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
          {loading && !data && (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          )}
          {error && !data && <ErrorRetry message={error} onRetry={refetch} />}
          {stale && data ? <OfflineNotice /> : null}
          {actionError && <Text style={styles.danger}>{actionError}</Text>}

          {data && (
            <>
              <Text style={styles.sectionTitle}>Предстоящие</Text>
              {upcoming.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    Записей нет. Записаться на занятие можно в расписании.
                  </Text>
                  <Pressable
                    onPress={() => navigateToTab("Schedule")}
                    accessibilityRole="button"
                    style={styles.emptyButton}
                  >
                    <Text style={styles.emptyButtonText}>Открыть расписание</Text>
                  </Pressable>
                </View>
              ) : (
                upcoming.map((b) => {
                  const started = new Date(b.startAt).getTime() <= now
                  const live = b.status === "BOOKED" || b.status === "WAITLISTED"
                  const promoted = b.status === "BOOKED" && !!b.promotedAt
                  const busy = busyId === b.id
                  return (
                    <View key={b.id} style={styles.card}>
                      <View style={styles.titleRow}>
                        <Text style={styles.title}>{b.groupName}</Text>
                        <Text
                          style={[
                            styles.pill,
                            b.status === "WAITLISTED" && styles.pillMuted,
                          ]}
                        >
                          {b.status === "WAITLISTED" && b.waitlistPosition
                            ? `Лист ожидания · №${b.waitlistPosition}`
                            : CLASS_BOOKING_STATUS_LABEL[b.status]}
                        </Text>
                      </View>
                      {classLines(b)}
                      {b.classCancelled && (
                        <Text style={styles.danger}>Занятие отменено</Text>
                      )}
                      {promoted && (
                        <Text style={styles.success}>
                          Вас записали из листа ожидания. Не сможете прийти —
                          откажитесь, чтобы место досталось следующему.
                        </Text>
                      )}
                      {b.status === "WAITLISTED" && (
                        <Text style={styles.note}>
                          {b.waitlistPosition
                            ? `Вы в листе ожидания, место №${b.waitlistPosition}. `
                            : "Вы в листе ожидания. "}
                          Если место освободится, вас запишут автоматически и
                          пришлют уведомление.
                        </Text>
                      )}
                      {b.status === "BOOKED" && !started && (
                        <Text style={[styles.note, b.lateCancelNow && styles.warning]}>
                          {b.lateCancelNow
                            ? `Срок бесплатной отмены прошёл (${formatDeadline(b.cancelDeadline, b.timezone)}).${b.lateCancelBurns ? " При отмене спишется занятие." : ""}`
                            : `Бесплатно отменить можно до ${formatDeadline(b.cancelDeadline, b.timezone)}.`}
                        </Text>
                      )}
                      {started && (
                        <Text style={styles.note}>Занятие уже началось.</Text>
                      )}
                      {live && !started && !b.classCancelled && (
                        <Pressable
                          onPress={() => confirmCancel(b)}
                          disabled={!!busyId}
                          accessibilityRole="button"
                          style={styles.button}
                        >
                          <Text style={styles.buttonText}>
                            {busy
                              ? "Отменяем…"
                              : b.status === "WAITLISTED"
                                ? "Покинуть лист ожидания"
                                : promoted
                                  ? "Отказаться"
                                  : "Отменить запись"}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )
                })
              )}

              {history.length > 0 && (
                <Text style={styles.sectionTitle}>История</Text>
              )}
              {history.map((b) => {
                const burned = burnLine(b)
                const bad = b.status === "LATE_CANCELLED" || b.status === "NO_SHOW"
                return (
                  <View key={b.id} style={[styles.card, styles.cardPast]}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>{b.groupName}</Text>
                      <Text
                        style={[
                          styles.status,
                          b.status === "ATTENDED" && styles.statusGood,
                          bad && styles.statusBad,
                        ]}
                      >
                        {CLASS_BOOKING_STATUS_LABEL[b.status]}
                      </Text>
                    </View>
                    {classLines(b)}
                    {burned && <Text style={styles.danger}>{burned}</Text>}
                    {b.status === "CANCELLED_BY_CLUB" && (
                      <Text style={styles.note}>Занятие с абонемента не списано.</Text>
                    )}
                  </View>
                )
              })}
            </>
          )}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    spinner: { paddingVertical: theme.spacing(6) },
    sectionTitle: {
      ...theme.typography.label,
      color: theme.colors.muted,
      marginTop: theme.spacing(2),
    },
    card: {
      gap: theme.spacing(1),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardPast: { backgroundColor: theme.colors.surface },
    titleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    title: {
      flexShrink: 1,
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
    },
    pill: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
      overflow: "hidden",
    },
    pillMuted: {
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.textSecondary,
    },
    status: { fontSize: 12, fontWeight: "700", color: theme.colors.muted },
    statusGood: { color: theme.colors.success },
    statusBad: { color: theme.colors.danger },
    when: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted },
    note: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
    warning: { color: theme.colors.warning },
    success: { fontSize: 13, fontWeight: "600", color: theme.colors.success },
    danger: { fontSize: 13, color: theme.colors.danger },
    button: {
      marginTop: theme.spacing(2),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    empty: {
      alignItems: "center",
      gap: theme.spacing(2),
      padding: theme.spacing(5),
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderStyle: "dashed",
    },
    emptyText: {
      ...theme.typography.caption,
      color: theme.colors.muted,
      textAlign: "center",
    },
    emptyButton: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    emptyButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  })
