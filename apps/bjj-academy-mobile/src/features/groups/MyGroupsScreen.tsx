import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getMyGroups, type MyGroup } from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { GroupScheduleWidget } from "../schedule/GroupScheduleWidget"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "MyGroups">

const formatCoach = (c: MyGroup["coach"]): string => {
  const name = [c.firstname, c.lastname].filter(Boolean).join(" ").trim()
  return name || c.email
}

export function MyGroupsScreen({ navigation }: Props) {
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
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Мои группы</Text>
        <Text style={styles.subtitle}>
          Группы, в которых ты состоишь как ученик или ведёшь как тренер.
        </Text>

        {stale && data ? <OfflineNotice /> : null}

        {error && !data ? (
          <ErrorRetry message={error} onRetry={refetch} />
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              Тебя пока ни в одну группу не добавили
            </Text>
            <Text style={styles.emptyText}>
              Спроси тренера или администратора клуба — они добавляют учеников
              в группы из админ-панели.
            </Text>
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Назад</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
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
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
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
  emptyButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing(2),
  },
  emptyButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  list: { gap: theme.spacing(2) },
  card: {
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
