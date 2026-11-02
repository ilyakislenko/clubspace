import { useFocusEffect } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  deleteMyDependent,
  listMyDependents,
  unlinkMyDependent,
  type MyDependent,
} from "../../shared/api/dependents"
import { exportMyData } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { ChildFormModal } from "./ChildFormModal"
import {
  childDataFileName,
  serializeMyData,
} from "../profile/my-data-file"
import { saveMyData } from "../profile/save-my-data"
import { ChildInviteCard } from "./ChildInviteCard"
import {
  dependentName,
  formatBirthDate,
  pendingInvites,
  RELATION_LABEL,
  switchableDependents,
} from "./children-helpers"
import { useProfileSwitch } from "./useProfileSwitch"

type Props = NativeStackScreenProps<RootStackParamList, "Children">

type FormState = { mode: "add" } | { mode: "edit"; child: MyDependent } | null

/**
 * «Дети»: the guardian's children and the clubs' invitations to confirm one.
 * Always as the guardian — from a child profile it only offers to switch back.
 */
export function ChildrenScreen(_props: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { actingAs, refresh } = useAuth()
  const { showToast } = useToast()
  const { busy: switching, switchTo } = useProfileSwitch()
  const [list, setList] = useState<MyDependent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [form, setForm] = useState<FormState>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const load = useCallback(async () => {
    try {
      const res = await listMyDependents()
      if (!mounted.current) return
      setList(res.data)
      setError(null)
    } catch (e) {
      if (mounted.current) setError(errorMessage(e, "Не удалось загрузить детей"))
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (!actingAs) void load()
    }, [actingAs, load]),
  )

  // After a change: this list, and the app's (profile switcher, a child that
  // can no longer be acted for).
  const reload = async () => {
    await load()
    void refresh()
  }

  const pullToRefresh = async () => {
    setRefreshing(true)
    await load()
    if (mounted.current) setRefreshing(false)
  }

  if (actingAs) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <CenteredColumn maxWidth={READABLE_WIDTH}>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.card}>
              <Text style={styles.name}>
                Сейчас открыт профиль ребёнка: {dependentName(actingAs)}
              </Text>
              <Text style={styles.text}>
                Добавлять детей, подтверждать приглашения клубов и менять их
                данные можно из вашего собственного профиля.
              </Text>
              <Pressable
                onPress={() => void switchTo(null, "Children")}
                disabled={switching !== null}
                accessibilityRole="button"
                style={styles.primary}
              >
                {switching ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.primaryText}>
                    Переключиться на свой профиль
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </CenteredColumn>
      </SafeAreaView>
    )
  }

  const unlink = (child: MyDependent) => {
    const name = dependentName(child)
    showAlert(
      "Убрать себя из родителей?",
      `Вы больше не сможете вести профиль ребёнка ${name}. Профиль останется у другого родителя.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Убрать",
          style: "destructive",
          onPress: async () => {
            setBusyId(child.id)
            try {
              await unlinkMyDependent(child.id)
              showToast(`${name} — больше не в вашем списке`)
              await reload()
            } catch (e) {
              showAlert("Не удалось убрать", errorMessage(e))
            } finally {
              if (mounted.current) setBusyId(null)
            }
          },
        },
      ],
    )
  }

  // The child's copy of their data (152-ФЗ ст. 14), without switching: the
  // export goes out with this child's X-Act-As explicitly.
  const exportChildData = async (child: MyDependent) => {
    setBusyId(child.id)
    try {
      const data = await exportMyData(child.id)
      const fileName = childDataFileName(data, child.id)
      const outcome = await saveMyData(fileName, serializeMyData(data))
      if (outcome === "saved") showToast(`Файл сохранён: ${fileName}`, "success")
    } catch (e) {
      showToast(
        errorMessage(e, "Не удалось выгрузить данные. Попробуйте ещё раз."),
        "error",
      )
    } finally {
      if (mounted.current) setBusyId(null)
    }
  }

  const remove = (child: MyDependent) => {
    const name = dependentName(child)
    showAlert(
      "Удалить профиль ребёнка?",
      `Профиль ${name} будет удалён навсегда — так же, как при удалении аккаунта: членство в клубах, абонементы, записи, посещения, ранги и достижения. Это действие необратимо и затронет всех родителей ребёнка.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            setBusyId(child.id)
            try {
              await deleteMyDependent(child.id)
              showToast(`Профиль ${name} удалён`)
              await reload()
            } catch (e) {
              showAlert("Не удалось удалить профиль", errorMessage(e))
            } finally {
              if (mounted.current) setBusyId(null)
            }
          },
        },
      ],
    )
  }

  const invites = list ? pendingInvites(list) : []
  const children = list ? switchableDependents(list) : []

  const action = (
    label: string,
    icon: React.ComponentProps<typeof Icon>["name"],
    onPress: () => void,
    opts?: { danger?: boolean; disabled?: boolean },
  ) => (
    <Pressable
      onPress={onPress}
      disabled={opts?.disabled}
      accessibilityRole="button"
      style={[styles.actionRow, opts?.disabled && styles.disabled]}
    >
      <Icon
        name={icon}
        size={18}
        color={opts?.danger ? theme.colors.danger : theme.colors.accent}
      />
      <Text style={[styles.actionText, opts?.danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void pullToRefresh()}
              tintColor={theme.colors.accent}
            />
          }
        >
          {!list ? (
            error ? (
              <ErrorRetry message={error} onRetry={() => void load()} />
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )
          ) : (
            <>
              {invites.length > 0 && (
                <View style={styles.group}>
                  <Text style={styles.groupTitle}>Приглашения от клубов</Text>
                  {invites.map((invite) => (
                    <ChildInviteCard
                      key={invite.id}
                      invite={invite}
                      onDone={() => void reload()}
                    />
                  ))}
                </View>
              )}

              <View style={styles.group}>
                <Text style={styles.groupTitle}>Мои дети</Text>
                {children.length === 0 && (
                  <Text style={styles.empty}>
                    Добавьте ребёнка, чтобы записывать его в клуб, отмечать на
                    тренировках и следить за абонементом из своего аккаунта.
                  </Text>
                )}
                {children.map((child) => {
                  const busy = busyId === child.id || switching === child.id
                  return (
                    <View key={child.id} style={styles.card}>
                      <View style={styles.headRow}>
                        <View style={styles.headText}>
                          <Text style={styles.name}>{dependentName(child)}</Text>
                          <Text style={styles.meta}>
                            {[
                              child.dateOfBirth
                                ? `д. р. ${formatBirthDate(child.dateOfBirth)}`
                                : null,
                              `вы: ${RELATION_LABEL[child.relation].toLowerCase()}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                        {busy && <ActivityIndicator color={theme.colors.accent} />}
                      </View>
                      <Text style={styles.text}>
                        {child.clubs.length > 0
                          ? `Клубы: ${child.clubs.map((c) => c.name).join(", ")}`
                          : "Пока не состоит в клубах"}
                      </Text>
                      <View style={styles.actions}>
                        {action(
                          "Переключиться",
                          "swap-horizontal",
                          () => void switchTo(child.id),
                          { disabled: busy || switching !== null },
                        )}
                        {action(
                          "Вступить в клуб за ребёнка",
                          "add-circle-outline",
                          () => void switchTo(child.id, "JoinClub"),
                          { disabled: busy || switching !== null },
                        )}
                        {action(
                          "Изменить имя и дату рождения",
                          "create-outline",
                          () => setForm({ mode: "edit", child }),
                          { disabled: busy },
                        )}
                        {action(
                          "Убрать себя из родителей",
                          "person-remove-outline",
                          () => unlink(child),
                          { disabled: busy },
                        )}
                        {action(
                          "Скачать данные ребёнка",
                          "download-outline",
                          () => void exportChildData(child),
                          { disabled: busy },
                        )}
                        {action(
                          "Удалить профиль ребёнка",
                          "trash-outline",
                          () => remove(child),
                          { danger: true, disabled: busy },
                        )}
                      </View>
                    </View>
                  )
                })}
              </View>

              <Pressable
                onPress={() => setForm({ mode: "add" })}
                accessibilityRole="button"
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Добавить ребёнка</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </CenteredColumn>

      {form && (
        <ChildFormModal
          child={form.mode === "edit" ? form.child : undefined}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null)
            showToast(
              form.mode === "add"
                ? `${dependentName(saved)} — в списке ваших детей`
                : "Сохранено",
              "success",
            )
            void reload()
          }}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(5) },
    group: { gap: theme.spacing(3) },
    groupTitle: { ...theme.typography.label, paddingHorizontal: theme.spacing(1) },
    empty: { ...theme.typography.body, color: theme.colors.muted },
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      gap: theme.spacing(2),
      ...theme.shadows.sm,
    },
    headRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    headText: { flex: 1, gap: 2 },
    name: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted },
    text: { ...theme.typography.body, color: theme.colors.textSecondary },
    actions: {
      marginTop: theme.spacing(1),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(3),
    },
    actionText: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    dangerText: { color: theme.colors.danger },
    disabled: { opacity: 0.5 },
    primary: {
      backgroundColor: theme.colors.accent,
      paddingVertical: theme.spacing(4),
      borderRadius: theme.radius.full,
      alignItems: "center",
      ...theme.shadows.sm,
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
  })
