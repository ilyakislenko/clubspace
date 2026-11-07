import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useMemo, useState } from "react"
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
  deleteMyStudyPlan,
  deleteMyStudyPlanItem,
  getMyStudyPlan,
  reorderMyStudyPlanItems,
  type StudyPlan,
  type StudyPlanItem,
  updateMyStudyPlan,
  updateMyStudyPlanItem,
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
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { uniqueTargets } from "../offline/bulk-download"
import { BulkDownloadPanel } from "../offline/BulkDownloadPanel"
import {
  useBulkDownload,
  type BulkDownloadCopy,
} from "../offline/use-bulk-download"
import { formatBookmarkTime } from "../video/format-position"
import { adjacentPlayableIndex } from "./plan-playback"
import { moveId } from "./plan-order"
import { planCacheKey, planChanged, planEditErrorMessage } from "./plan-store"
import { PlanTextModal } from "./PlanTextModal"

type Props = NativeStackScreenProps<RootStackParamList, "StudyPlan">

type Editing = { kind: "plan" } | { kind: "item"; item: StudyPlanItem }

const PLAN_BULK_COPY: BulkDownloadCopy = {
  confirmTitle: "Скачать план?",
  allDoneTitle: "План уже скачан",
  allDoneMessage: "Видео всех доступных фрагментов уже в загруженном.",
}

// One study plan: its items in play order (reorder with ↑/↓), «Играть план»
// from the first item or from any item tapped. Cached for offline viewing and
// playing; edits need the network.
export function StudyPlanScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const { planId } = route.params
  const workspaceId = workspace?.workspaceId ?? null
  const resource = useCachedResource(
    workspaceId ? planCacheKey(workspaceId, planId) : null,
    useCallback(
      async () => await getMyStudyPlan({ workspaceId: workspaceId!, planId }),
      [workspaceId, planId],
    ),
  )
  const plan = resource.data
  const offlineDownloads = useOfflineDownloadsAllowed()
  // For the gym: every playable item's lesson, each once. Opening this
  // screen caches the plan (planCacheKey), which is what plan playback reads
  // offline (loadStudyPlan).
  const bulkTargets = useMemo(
    () =>
      uniqueTargets(
        (plan?.items ?? [])
          .filter((item) => item.accessible)
          .map((item) => ({
            videoId: item.videoId,
            thumbnailUrl: item.video?.thumbnailUrl,
          })),
      ),
    [plan],
  )
  const bulk = useBulkDownload({
    workspaceId,
    targets: bulkTargets,
    copy: PLAN_BULK_COPY,
  })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (plan) navigation.setOptions({ title: plan.title })
  }, [navigation, plan])

  // Runs an edit; the server's answer replaces the plan on screen.
  const edit = async (
    run: () => Promise<StudyPlan>,
    failure: string,
    optimistic?: StudyPlan,
  ) => {
    if (!workspaceId || busy) return
    setBusy(true)
    // Kept to roll back to if the optimistic change fails.
    const previous = plan
    if (optimistic) resource.mutate(optimistic)
    try {
      const updated = await run()
      resource.mutate(updated)
      await planChanged(workspaceId, updated)
    } catch (e) {
      if (optimistic && previous) resource.mutate(previous)
      showToast(planEditErrorMessage(e, failure), "error")
    } finally {
      setBusy(false)
    }
  }

  const play = (index: number) => {
    if (!plan) return
    const item = plan.items[index]
    if (!item?.accessible) return
    navigation.navigate("Video", {
      videoId: item.videoId,
      title: item.video?.title ?? item.title,
      startAt: item.startSec,
      planId: plan.id,
      planItemIndex: index,
    })
  }

  const move = (index: number, delta: number) => {
    if (!plan || !workspaceId) return
    const ids = moveId(
      plan.items.map((i) => i.id),
      index,
      delta,
    )
    const byId = new Map(plan.items.map((i) => [i.id, i]))
    void edit(
      () => reorderMyStudyPlanItems({ workspaceId, planId, itemIds: ids }),
      "Не удалось изменить порядок.",
      { ...plan, items: ids.map((id) => byId.get(id)!) },
    )
  }

  const removeItem = (item: StudyPlanItem) =>
    showAlert("Убрать из плана?", item.title || item.video?.title || undefined, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Убрать",
        style: "destructive",
        onPress: () =>
          void edit(
            () =>
              deleteMyStudyPlanItem({ workspaceId: workspaceId!, planId, itemId: item.id }),
            "Не удалось убрать фрагмент.",
          ),
      },
    ])

  const removePlan = () =>
    showAlert("Удалить план?", plan ? `«${plan.title}» и все его фрагменты.` : undefined, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          if (!workspaceId) return
          try {
            await deleteMyStudyPlan({ workspaceId, planId })
            await planChanged(workspaceId)
            showToast("План удалён")
            navigation.goBack()
          } catch (e) {
            showToast(planEditErrorMessage(e, "Не удалось удалить план."), "error")
          }
        },
      },
    ])

  const submitEditing = async (title: string, text: string) => {
    if (!workspaceId || !editing) return
    const updated =
      editing.kind === "plan"
        ? await updateMyStudyPlan({
            workspaceId,
            planId,
            data: { title, description: text || null },
          })
        : await updateMyStudyPlanItem({
            workspaceId,
            planId,
            itemId: editing.item.id,
            data: { title, note: text || null },
          })
    resource.mutate(updated)
    await planChanged(workspaceId, updated)
    setEditing(null)
  }

  if (!plan) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        {resource.error ? (
          <ErrorRetry message={resource.error} onRetry={resource.refetch} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
      </SafeAreaView>
    )
  }

  const firstPlayable = adjacentPlayableIndex(plan.items, -1, 1)
  const last = plan.items.length - 1

  const renderItem = ({ item, index }: { item: StudyPlanItem; index: number }) => {
    const time = formatBookmarkTime({ positionSec: item.startSec, endSec: item.endSec })
    const name = item.title || item.video?.title || "Без названия"
    return (
      <View style={styles.card}>
        <Pressable
          onPress={() => play(index)}
          disabled={!item.accessible}
          accessibilityRole="button"
          accessibilityLabel={
            item.accessible
              ? `Играть план с фрагмента ${index + 1}: ${name}, ${time}`
              : `Фрагмент ${index + 1} недоступен`
          }
          style={({ pressed }) => [styles.head, pressed && styles.pressed]}
        >
          <Text style={styles.index}>{index + 1}</Text>
          {item.video?.thumbnailUrl ? (
            <Image source={{ uri: item.video.thumbnailUrl }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              {item.accessible ? (
                <PlayGlyph />
              ) : (
                <Text style={styles.lockedText}>Недоступно</Text>
              )}
            </View>
          )}
          <View style={styles.headText}>
            <View style={styles.timeChip}>
              <Text style={styles.timeText}>{time}</Text>
            </View>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {name}
            </Text>
            {item.title && item.video ? (
              <Text style={styles.muted} numberOfLines={1}>
                {item.video.title}
              </Text>
            ) : null}
            {!item.accessible && (
              <Text style={styles.muted}>Видео сейчас недоступно — будет пропущено</Text>
            )}
          </View>
        </Pressable>
        {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
        <View style={styles.actions}>
          <SmallButton
            label="↑"
            accessibilityLabel="Выше"
            disabled={busy || index === 0}
            onPress={() => move(index, -1)}
          />
          <SmallButton
            label="↓"
            accessibilityLabel="Ниже"
            disabled={busy || index === last}
            onPress={() => move(index, 1)}
          />
          <View style={styles.spacer} />
          <SmallButton
            label="Изменить"
            accessibilityLabel="Изменить название и заметку"
            disabled={busy}
            onPress={() => setEditing({ kind: "item", item })}
          />
          <SmallButton
            label="✕"
            accessibilityLabel="Убрать из плана"
            disabled={busy}
            onPress={() => removeItem(item)}
          />
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <FlatList
          data={plan.items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={resource.refreshing}
              onRefresh={resource.refetch}
              tintColor={theme.colors.accent}
            />
          }
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              {resource.stale && (
                <OfflineNotice message="Нет сети — показан сохранённый план" />
              )}
              {plan.description ? (
                <Text style={styles.description}>{plan.description}</Text>
              ) : null}
              <Text style={styles.muted}>
                {plan.items.length}{" "}
                {pluralRu(plan.items.length, "фрагмент", "фрагмента", "фрагментов")}
              </Text>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => firstPlayable != null && play(firstPlayable)}
                  disabled={firstPlayable == null}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.playButton,
                    firstPlayable == null && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <PlayGlyph size={12} color={theme.colors.accentText} />
                  <Text style={styles.playText}>Играть план</Text>
                </Pressable>
                <SmallButton
                  label="Изменить"
                  accessibilityLabel="Переименовать план"
                  onPress={() => setEditing({ kind: "plan" })}
                />
                <SmallButton
                  label="Удалить"
                  accessibilityLabel="Удалить план"
                  onPress={removePlan}
                />
              </View>
              {offlineDownloads && bulk.total > 0 && (
                <BulkDownloadPanel
                  bulk={bulk}
                  label="Скачать план"
                  allDownloadedLabel="План уже загружен"
                />
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>План пока пуст</Text>
              <Text style={styles.emptyHint}>
                Откройте видео и нажмите «В план» у закладки, отрезка или главы —
                или «В план» в момент, который хотите отработать.
              </Text>
            </View>
          }
        />
      </CenteredColumn>

      {editing && (
        <PlanTextModal
          heading={editing.kind === "plan" ? "Изменить план" : "Изменить фрагмент"}
          titleLabel="Название"
          titleOptional={editing.kind === "item"}
          titleInitial={editing.kind === "plan" ? plan.title : editing.item.title}
          textLabel={editing.kind === "plan" ? "Описание" : "Заметка"}
          textInitial={
            editing.kind === "plan" ? plan.description : editing.item.note
          }
          textPlaceholder={
            editing.kind === "plan"
              ? "Зачем этот план, на что обратить внимание"
              : "Что важно в этом моменте"
          }
          onSubmit={submitEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  )
}

function SmallButton({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
}: {
  label: string
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.smallButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: theme.spacing(5), paddingTop: theme.spacing(3), gap: theme.spacing(3) },
    header: { gap: theme.spacing(2), marginBottom: theme.spacing(1) },
    description: { ...theme.typography.body, color: theme.colors.text },
    headerActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(2),
      marginTop: theme.spacing(1),
    },
    playButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    playText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    card: {
      gap: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    head: { flexDirection: "row", gap: theme.spacing(3), alignItems: "center" },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.4 },
    index: {
      width: 20,
      textAlign: "center",
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.muted,
      fontVariant: ["tabular-nums"],
    },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    lockedText: { fontSize: 11, color: theme.colors.muted },
    headText: { flex: 1, gap: 3, alignItems: "flex-start" },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    itemTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    muted: { fontSize: 12, color: theme.colors.muted },
    note: { ...theme.typography.body, color: theme.colors.text },
    actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    spacer: { flex: 1 },
    smallButton: {
      minWidth: 36,
      alignItems: "center",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1) + 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    smallButtonText: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
    empty: { alignItems: "center", paddingHorizontal: theme.spacing(6), paddingTop: theme.spacing(8) },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      marginBottom: theme.spacing(2),
    },
    emptyHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
  })
