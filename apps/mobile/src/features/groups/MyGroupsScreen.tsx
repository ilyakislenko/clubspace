import { useNavigation } from "@react-navigation/native"
import React, { useCallback } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView, type Edge } from "react-native-safe-area-context"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"

import { getMyGroups, type MyGroup } from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { GroupScheduleWidget } from "../schedule/GroupScheduleWidget"
import { findTodaySlot, foreignTzSuffix } from "../schedule/schedule-helpers"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { AppNavigation } from "../../app/navigation"

const formatCoach = (c: MyGroup["coach"]): string => {
  const name = [c.firstname, c.lastname].filter(Boolean).join(" ").trim()
  return name || c.email
}

// Both the Schedule tab (when the club hides its schedule) and a pushed screen.
export function MyGroupsScreen({ asTab = false }: { asTab?: boolean }) {
  // The tab bar already clears the home indicator; only the pushed screen needs it.
  const edges: Edge[] = asTab ? [] : ["bottom"]
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const { data, error, loading, stale, refetch } = useCachedResource<MyGroup[]>(
    workspace ? `groups:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyGroups({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  const groups = data ?? []

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={edges}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subtitle}>
          Группы, в которых вы состоите как ученик или ведёте как тренер.
        </Text>

        {stale && data ? <OfflineNotice /> : null}

        {error && !data ? (
          <ErrorRetry message={error} onRetry={refetch} />
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              Вас пока ни в одну группу не добавили
            </Text>
            <Text style={styles.emptyText}>
              Спросите тренера или администратора клуба — они добавляют учеников
              в группы из админ-панели.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <ResponsiveGrid>
            {groups.map((g) => (
              <View key={`${g.role}-${g.id}`} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardName}>{g.name}</Text>
                  <View
                    style={[
                      styles.rolePill,
                      g.role === "coach" ? styles.rolePillCoach : styles.rolePillStudent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rolePillText,
                        g.role === "coach" && styles.rolePillTextCoach,
                      ]}
                    >
                      {g.role === "coach" ? "Тренер" : "Ученик"}
                    </Text>
                  </View>
                </View>

                {g.gym ? (
                  <Text style={styles.cardLine}>
                    {g.gym.name} · {g.gym.address}
                  </Text>
                ) : (
                  <Text style={styles.cardLineMuted}>Зал не указан</Text>
                )}

                {g.role === "student" && (
                  <Text style={styles.cardLine}>
                    Тренер: {formatCoach(g.coach)}
                  </Text>
                )}

                <Text style={styles.cardLineMuted}>
                  {g.memberCount} в группе
                </Text>

                <GroupScheduleWidget
                  slots={g.slots}
                  exceptions={g.exceptions}
                  timeZone={g.timezone}
                />

                {g.role === "coach" && (
                  <AttendanceAction
                    group={g}
                    onOpen={(slotId, sessionDate) =>
                      navigation.navigate("SessionAttendance", {
                        slotId,
                        sessionDate,
                        groupName: g.name,
                      })
                    }
                  />
                )}
              </View>
            ))}
            </ResponsiveGrid>
          </View>
        )}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

// Opens today's roster for a coached group (same create-or-open flow as the
// club schedule). Works without the schedule feature, which hides that screen.
function AttendanceAction({
  group,
  onOpen,
}: {
  group: MyGroup
  onOpen: (slotId: string, sessionDate: string) => void
}) {
  const styles = useThemedStyles(makeStyles)
  const today = findTodaySlot(
    group.slots,
    group.exceptions,
    new Date(),
    group.timezone,
  )
  if (!today) {
    return (
      <Text style={styles.cardLineMuted}>
        Сегодня занятий по расписанию нет
      </Text>
    )
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.attendance, pressed && styles.pressed]}
      onPress={() => onOpen(today.slot.id, today.dateStr)}
    >
      <Text style={styles.attendanceText}>
        Отметить посещаемость · {today.slot.startTime}
        {foreignTzSuffix(group.timezone, new Date())}
      </Text>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(3),
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(6),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptyTitle: {
    ...theme.typography.bodyStrong,
    color: theme.colors.text,
    textAlign: "center",
  },
  emptyText: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  list: { gap: theme.spacing(2) },
  card: {
    flexGrow: 1,
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardName: {
    ...theme.typography.subheading,
    color: theme.colors.text,
    flex: 1,
  },
  cardLine: {
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  cardLineMuted: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  attendance: {
    alignSelf: "flex-start",
    marginTop: theme.spacing(2),
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  attendanceText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 14,
  },
  pressed: { opacity: 0.7 },
  rolePill: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  rolePillCoach: {
    backgroundColor: theme.colors.accent,
  },
  rolePillStudent: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.text,
  },
  rolePillTextCoach: {
    color: theme.colors.accentText,
  },
})
