import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  createMyStudyPlan,
  deleteMyStudyPlan,
  listMyStudyPlans,
  type StudyPlanSummary,
  updateMyStudyPlan,
} from "../../shared/api/study-plans"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { useToast } from "../../shared/components/Toast"
import { pluralRu } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { planChanged, planEditErrorMessage, plansCacheKey } from "./plan-store"
import { PlanTextModal } from "./PlanTextModal"

type Props = NativeStackScreenProps<RootStackParamList, "StudyPlans">

type Editing = { kind: "create" } | { kind: "rename"; plan: StudyPlanSummary }

// «Мои планы»: the member's study plans in this club — moments and segments
// from different lessons to play back to back. Cached for offline viewing;
// creating, renaming and deleting need the network.
export function StudyPlansScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const workspaceId = workspace?.workspaceId ?? null
  const plans = useCachedResource(
    workspaceId ? plansCacheKey(workspaceId) : null,
    useCallback(
      async () => await listMyStudyPlans({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const [editing, setEditing] = useState<Editing | null>(null)

  const openPlan = (plan: { id: string; title: string }) =>
    navigation.navigate("StudyPlan", { planId: plan.id, title: plan.title })

  const submit = async (title: string, description: string) => {
    if (!workspaceId || !editing) return
    if (editing.kind === "create") {
      const created = await createMyStudyPlan({
        workspaceId,
        data: { title, description: description || null },
      })
      await planChanged(workspaceId, created)
      setEditing(null)
      openPlan(created)
      return
    }
    const updated = await updateMyStudyPlan({
      workspaceId,
      planId: editing.plan.id,
      data: { title, description: description || null },
    })
    await planChanged(workspaceId, updated)
    setEditing(null)
  }

  const remove = (plan: StudyPlanSummary) =>
    showAlert("Удалить план?", `«${plan.title}» и все его фрагменты.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          if (!workspaceId) return
          try {
            await deleteMyStudyPlan({ workspaceId, planId: plan.id })
            plans.mutate((prev) =>
              prev ? { items: prev.items.filter((p) => p.id !== plan.id) } : prev,
            )
            await planChanged(workspaceId)
            showToast("План удалён")
          } catch (e) {
            showToast(planEditErrorMessage(e, "Не удалось удалить план."), "error")
          }
        },
      },
    ])

  const renderItem = ({ item }: { item: StudyPlanSummary }) => (
    <Pressable
      onPress={() => openPlan(item)}
      accessibilityRole="button"
      accessibilityLabel={`План ${item.title}, ${item.itemCount} ${pluralRu(item.itemCount, "фрагмент", "фрагмента", "фрагментов")}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.coverUrl ? (
        <Image source={{ uri: item.coverUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <PlayGlyph />
        </View>
      )}
      <View style={styles.cardText}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.muted}>
          {item.itemCount}{" "}
          {pluralRu(item.itemCount, "фрагмент", "фрагмента", "фрагментов")}
        </Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => setEditing({ kind: "rename", plan: item })}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Переименовать план ${item.title}`}
        style={styles.rowAction}
      >
        <Text style={styles.rowActionText}>✎</Text>
      </Pressable>
      <Pressable
        onPress={() => remove(item)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Удалить план ${item.title}`}
        style={styles.rowAction}
      >
        <Text style={styles.rowActionText}>✕</Text>
      </Pressable>
    </Pressable>
  )

  const items = plans.data?.items ?? []

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.top}>
          <Pressable
            onPress={() => setEditing({ kind: "create" })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
          >
            <Text style={styles.createText}>+ Новый план</Text>
          </Pressable>
          {plans.stale && (
            <OfflineNotice message="Нет сети — показаны сохранённые планы" />
          )}
        </View>

        {plans.loading && !plans.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : plans.error && !plans.data ? (
          <ErrorRetry message={plans.error} onRetry={plans.refetch} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={plans.refreshing}
                onRefresh={plans.refetch}
                tintColor={theme.colors.accent}
              />
            }
            contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Пока нет планов</Text>
                <Text style={styles.emptyHint}>
                  Соберите связку из моментов разных видео — например, «Защита
                  → выход → контратака» — и смотрите её подряд. Добавляйте
                  закладки, отрезки и главы кнопкой «В план» под видео.
                </Text>
              </View>
            }
          />
        )}
      </CenteredColumn>

      {editing && (
        <PlanTextModal
          heading={editing.kind === "create" ? "Новый план" : "Изменить план"}
          titleLabel="Название"
          titleInitial={editing.kind === "rename" ? editing.plan.title : ""}
          textLabel="Описание"
          textInitial={editing.kind === "rename" ? editing.plan.description : ""}
          textPlaceholder="Зачем этот план, на что обратить внимание"
          submitLabel={editing.kind === "create" ? "Создать" : "Сохранить"}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    top: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(2),
    },
    createButton: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    createText: { color: theme.colors.accentText, fontSize: 14, fontWeight: "700" },
    list: {
      padding: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(3),
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pressed: { opacity: 0.85 },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    cardText: { flex: 1, gap: 3 },
    title: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    muted: { fontSize: 12, color: theme.colors.muted },
    description: { fontSize: 13, color: theme.colors.textSecondary },
    rowAction: { paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1) },
    rowActionText: { fontSize: 16, color: theme.colors.muted, fontWeight: "600" },
    empty: { alignItems: "center", paddingHorizontal: theme.spacing(8) },
    emptyWrap: { flex: 1, justifyContent: "center" },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      marginBottom: theme.spacing(2),
    },
    emptyHint: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
    },
  })
