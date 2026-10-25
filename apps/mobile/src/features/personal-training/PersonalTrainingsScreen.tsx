import { useNavigation } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"

import type { AppNavigation } from "../../app/navigation"
import { fetchMe } from "../../shared/api/me"
import {
  listPersonalTrainings,
  setPersonalTrainingOffer,
  type PersonalTraining,
  type PersonalTrainingList,
} from "../../shared/api/personal-trainings"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { SplitLayout } from "../../shared/components/SplitLayout"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatDuration, formatUpcomingLabel } from "../schedule/schedule-helpers"
import {
  groupForList,
  primaryTime,
  viewerRole,
} from "./personal-training-helpers"
import { PtStatusPill } from "./PtStatusPill"

export function PersonalTrainingsScreen() {
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  // Same key as Home's, so each paints the other's data.
  const me = useCachedResource(
    workspaceId ? `me:${workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  // `:me` is the realtime scope: the server refreshes both participants' lists.
  const list = useCachedResource<PersonalTrainingList>(
    workspaceId ? `personal-trainings:me:${workspaceId}` : null,
    useCallback(
      async () => await listPersonalTrainings({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )

  if (!workspace) return null

  if (!list.data || !me.data) {
    if (list.error || me.error) {
      return (
        <View style={styles.root}>
          <ErrorRetry
            message={(list.error ?? me.error)!}
            onRetry={() => {
              list.refetch()
              me.refetch()
            }}
          />
        </View>
      )
    }
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    )
  }

  const meId = me.data.id
  const { canOffer, offersPersonalTraining, coachesAvailable } = list.data
  // Per render: the screen is revisited while a session slides into the past.
  const now = new Date()
  const groups = groupForList(list.data.data, meId, now)
  const sections: Array<{ title: string; items: PersonalTraining[] }> = [
    { title: "Ждут вашего ответа", items: groups.needsAction },
    { title: "Предстоящие", items: groups.upcoming },
    { title: "В ожидании", items: groups.waiting },
    { title: "История", items: groups.history },
  ]
  const isEmpty = sections.every((s) => s.items.length === 0)

  const toggleOffer = async (enabled: boolean) => {
    if (toggling) return
    setToggling(true)
    setToggleError(null)
    try {
      const res = await setPersonalTrainingOffer({
        workspaceId: workspace.workspaceId,
        enabled,
      })
      list.mutate((prev) =>
        prev
          ? { ...prev, offersPersonalTraining: res.offersPersonalTraining }
          : prev,
      )
    } catch (e) {
      setToggleError(errorMessage(e, "Не удалось сохранить"))
    } finally {
      setToggling(false)
    }
  }

  const side = (
    <>
      {canOffer && (
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              Провожу персональные тренировки
            </Text>
            <Switch
              accessibilityLabel="Провожу персональные тренировки"
              value={offersPersonalTraining}
              disabled={toggling}
              onValueChange={(v) => void toggleOffer(v)}
              trackColor={{
                true: theme.colors.accent,
                false: theme.colors.border,
              }}
            />
          </View>
          <Text style={styles.muted}>
            {offersPersonalTraining
              ? "Ученики видят вас в списке и могут предложить время."
              : "Включите, чтобы ученики могли записываться к вам на персональные тренировки."}
          </Text>
          {toggleError && <Text style={styles.danger}>{toggleError}</Text>}
        </View>
      )}
      {coachesAvailable > 0 ? (
        <Pressable
          onPress={() => navigation.navigate("PersonalTrainingRequest")}
          accessibilityRole="button"
          style={styles.cta}
        >
          <Text style={styles.ctaText}>Записаться на персональную тренировку</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>
          Пока никто из тренеров не проводит персональные тренировки.
        </Text>
      )}
    </>
  )

  const main = isEmpty ? (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        Здесь появятся ваши заявки на персональные тренировки.
      </Text>
    </View>
  ) : (
    <>
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <ResponsiveGrid columns={{ medium: 2, expanded: 2 }}>
              {s.items.map((pt) => (
                <RequestRow
                  key={pt.id}
                  pt={pt}
                  meId={meId}
                  now={now}
                  onPress={() =>
                    navigation.navigate("PersonalTraining", {
                      requestId: pt.id,
                    })
                  }
                />
              ))}
            </ResponsiveGrid>
          </View>
        ))}
    </>
  )

  return (
    <View style={styles.root}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={list.refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {list.stale && <OfflineNotice />}
          <SplitLayout
            sidePosition="start"
            stackSideFirst
            side={side}
            main={main}
          />
        </ScrollView>
      </CenteredColumn>
    </View>
  )
}

function RequestRow({
  pt,
  meId,
  now,
  onPress,
}: {
  pt: PersonalTraining
  meId: string
  now: Date
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const viewer = viewerRole(pt, meId)
  const title =
    viewer === "member"
      ? `Тренер: ${pt.coach.displayName}`
      : viewer === "coach"
        ? pt.member.displayName
        : `${pt.member.displayName} · ${pt.coach.displayName}`
  const time = primaryTime(pt)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <PtStatusPill status={pt.displayStatus} />
      <Text style={styles.rowTitle} numberOfLines={2}>
        {title}
      </Text>
      {time && (
        <Text style={styles.rowTime}>
          {formatUpcomingLabel(new Date(time.startAt), pt.timezone, now)}
          {time.durationMin > 0 ? ` · ${formatDuration(time.durationMin)}` : ""}
        </Text>
      )}
      <Text style={styles.rowMeta} numberOfLines={1}>
        {pt.gym ? pt.gym.name : "Зал не выбран"}
      </Text>
    </Pressable>
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
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    card: {
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
    },
    switchLabel: {
      flex: 1,
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
    },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    danger: { ...theme.typography.caption, color: theme.colors.danger },
    cta: {
      paddingVertical: theme.spacing(4),
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
    },
    ctaText: {
      color: theme.colors.accentText,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
    },
    section: { gap: theme.spacing(2) },
    sectionTitle: { ...theme.typography.label, color: theme.colors.muted },
    row: {
      alignItems: "flex-start",
      gap: theme.spacing(1),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pressed: { opacity: 0.7 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    rowTime: { color: theme.colors.text, fontSize: 13 },
    rowMeta: { color: theme.colors.muted, fontSize: 12 },
    empty: {
      alignItems: "center",
      padding: theme.spacing(6),
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
  })
