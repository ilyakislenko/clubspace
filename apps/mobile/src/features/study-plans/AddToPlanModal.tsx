import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import {
  addMyStudyPlanItem,
  createMyStudyPlan,
  listMyStudyPlans,
  type StudyPlanSummary,
} from "../../shared/api/study-plans"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { pluralRu } from "../../shared/format-ru"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useOverlayPresence } from "../../shared/overlay-presence"
import { formatBookmarkTime } from "../video/format-position"
import type { PlanItemDraft } from "./plan-drafts"
import { planChanged, planEditErrorMessage, plansCacheKey } from "./plan-store"

type Props = {
  draft: PlanItemDraft
  onClose: () => void
}

// «Добавить в план»: pick one of the member's plans, or start a new one with
// this moment as its first item.
export function AddToPlanModal({ draft, onClose }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const workspaceId = workspace?.workspaceId ?? null
  useOverlayPresence(true)
  const plans = useCachedResource(
    workspaceId ? plansCacheKey(workspaceId) : null,
    useCallback(
      async () => await listMyStudyPlans({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A plan created here whose item add failed: retries add to it instead of
  // creating another one.
  const createdPlan = useRef<{ id: string; title: string } | null>(null)

  const addTo = async (plan: { id: string; title: string } | null) => {
    if (!workspaceId || busy) return
    setBusy(true)
    setError(null)
    try {
      const target =
        plan ??
        createdPlan.current ??
        (createdPlan.current = await createMyStudyPlan({
          workspaceId,
          data: { title: newTitle.trim(), description: null },
        }))
      const updated = await addMyStudyPlanItem({
        workspaceId,
        planId: target.id,
        data: draft,
      })
      await planChanged(workspaceId, updated)
      haptics.success()
      showToast(`Добавлено в план «${target.title}»`, "success")
      onClose()
    } catch (e) {
      setError(planEditErrorMessage(e, "Не удалось добавить в план."))
      setBusy(false)
    }
  }

  const list: StudyPlanSummary[] = plans.data?.items ?? []
  const label = draft.title || formatBookmarkTime({
    positionSec: draft.startSec,
    endSec: draft.endSec,
  })

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          onAccessibilityEscape={onClose}
          accessibilityRole="none"
        >
          <Pressable
            style={styles.sheet}
            accessibilityRole="none"
            onPress={() => {
              /* swallow, so a tap inside the sheet doesn't dismiss it */
            }}
          >
            <Text style={styles.title}>Добавить в план</Text>
            <Text style={styles.hint} numberOfLines={2}>
              {label}
            </Text>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {plans.loading && !plans.data ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : plans.error && !plans.data ? (
                <Text style={styles.error}>{plans.error}</Text>
              ) : (
                list.map((plan) => (
                  <Pressable
                    key={plan.id}
                    onPress={() => void addTo(plan)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Добавить в план ${plan.title}`}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {plan.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {plan.itemCount}{" "}
                      {pluralRu(plan.itemCount, "фрагмент", "фрагмента", "фрагментов")}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>

            {creating ? (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.input}
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Название плана"
                  placeholderTextColor={theme.colors.muted}
                  maxLength={120}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (newTitle.trim()) void addTo(null)
                  }}
                />
                <Pressable
                  onPress={() => void addTo(null)}
                  disabled={busy || !newTitle.trim()}
                  accessibilityRole="button"
                  style={[
                    styles.createButton,
                    !newTitle.trim() && styles.disabled,
                  ]}
                >
                  <Text style={styles.createText}>Создать</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setCreating(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.newPlan, pressed && styles.pressed]}
              >
                <Text style={styles.newPlanText}>+ Новый план…</Text>
              </Pressable>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
            {busy && <ActivityIndicator color={theme.colors.accent} />}

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      maxWidth: 460,
      maxHeight: "90%",
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      padding: theme.spacing(5),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    title: { fontSize: 20, fontWeight: "700", color: theme.colors.text },
    hint: { fontSize: 13, color: theme.colors.muted },
    list: { flexGrow: 0, maxHeight: 280 },
    listContent: { gap: theme.spacing(1) },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(3),
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    pressed: { opacity: 0.85 },
    rowTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: theme.colors.text },
    rowMeta: { fontSize: 12, color: theme.colors.muted },
    newPlan: {
      paddingVertical: theme.spacing(3),
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
    },
    newPlanText: { fontSize: 15, fontWeight: "600", color: theme.colors.accent },
    newRow: { flexDirection: "row", gap: theme.spacing(2), alignItems: "center" },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(3),
      fontSize: 16,
      color: theme.colors.text,
    },
    createButton: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    createText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    disabled: { opacity: 0.5 },
    error: { color: theme.colors.danger, fontSize: 13 },
    cancel: { alignSelf: "center", paddingVertical: theme.spacing(2) },
    cancelText: { fontSize: 15, color: theme.colors.muted, fontWeight: "600" },
  })
