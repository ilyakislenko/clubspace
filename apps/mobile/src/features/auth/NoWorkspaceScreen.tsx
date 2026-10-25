import { brandFromWorkspaceType } from "@clubspace/ui-kit/brand"
import { useFocusEffect } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import { listMyJoinRequests, type JoinRequest } from "../../shared/api/join"
import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { environment } from "../../shared/env"
import { SCAN_QR_HINT } from "../join/join-code"
import { shareFeedback, shareText } from "../../shared/share"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { EditNameModal } from "../profile/EditNameModal"
import { onboardingView } from "./onboarding-view"
import { displayName } from "./switchable-workspaces"

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">

export function NoWorkspaceScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { signOut, refresh } = useAuth()
  const { showToast } = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [requests, setRequests] = useState<JoinRequest[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const mounted = useRef(true)
  const name = displayName(me)
  const { emoji } = brandFromWorkspaceType(environment.brand)

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await listMyJoinRequests()
      if (!mounted.current) return
      setRequests(res.data)
      setLoadFailed(false)
    } catch {
      if (mounted.current) setLoadFailed(true)
    }
  }, [])

  // Also on coming back from the join screen, where a request may have been made.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const view = requests
    ? onboardingView({ whiteLabelKey: brand.workspaceKey, requests })
    : null

  const handleCheck = async () => {
    if (checking) return
    setChecking(true)
    await refresh()
    // Approved: App swaps this screen out and it unmounts. Still here = pending.
    if (!mounted.current) return
    await load()
    if (!mounted.current) return
    setChecking(false)
    showToast(
      view?.kind === "wl-pending"
        ? "Заявка ещё не подтверждена — тренер или администратор клуба получил уведомление"
        : "Заявку ещё не приняли — администратор клуба получил уведомление",
    )
  }

  const handleShareEmail = async () => {
    if (!me) return
    // This is the only action on this screen — it must never be a no-op.
    const feedback = shareFeedback(
      await shareText({
        message: `Привет! Добавь меня в клуб, мой email: ${me.email}`,
      }),
    )
    if (feedback) showToast(feedback)
  }

  const joinButton = (primary: boolean) => (
    <Pressable
      onPress={() => navigation.navigate("JoinClub")}
      accessibilityRole="button"
      style={({ pressed }) => [
        primary ? styles.primaryBtn : styles.secondaryBtn,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={primary ? styles.primaryBtnText : styles.secondaryBtnText}>
        {primary ? "Ввести код клуба" : "Ввести другой код"}
      </Text>
    </Pressable>
  )

  const checkButton = (
    <Pressable
      onPress={() => void handleCheck()}
      disabled={checking}
      style={({ pressed }) => [
        styles.primaryBtn,
        pressed && styles.btnPressed,
      ]}
    >
      {checking ? (
        <ActivityIndicator color={theme.colors.accentText} />
      ) : (
        <Text style={styles.primaryBtnText}>Проверить ещё раз</Text>
      )}
    </Pressable>
  )

  const signOutButton = (
    <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOutBtn}>
      <Text style={styles.signOutText}>Выйти</Text>
    </Pressable>
  )

  const icon = (glyph: string) => (
    <Text
      style={styles.icon}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // react-native-web ignores the two RN props above.
      aria-hidden
    >
      {glyph}
    </Text>
  )

  const renderBody = () => {
    if (loadFailed && !view) {
      return (
        <ErrorRetry message="Не удалось загрузить заявки" onRetry={load} />
      )
    }
    if (!view) return <ActivityIndicator color={theme.colors.accent} />

    switch (view.kind) {
      case "welcome":
        return (
          <>
            {icon(emoji)}
            <Text style={styles.title}>Присоединитесь к клубу</Text>
            <Text style={styles.subtitle}>
              Введите код клуба — его даёт тренер или администратор. Если у вас
              есть ссылка-приглашение или QR-код, просто откройте их.
            </Text>
            <View style={styles.actions}>
              {joinButton(true)}
              <Pressable
                onPress={() =>
                  showAlert(SCAN_QR_HINT.title, SCAN_QR_HINT.message)
                }
                hitSlop={8}
                style={styles.signOutBtn}
              >
                <Text style={styles.nameLink}>{SCAN_QR_HINT.link}</Text>
              </Pressable>
              {me && (
                <Text style={styles.subtitle}>Вы вошли как {me.email}</Text>
              )}
              {signOutButton}
            </View>
          </>
        )
      case "requests":
        return (
          <>
            {view.pending.map((r) => (
              <View key={r.workspaceId} style={styles.emailCard}>
                <Text style={styles.chip}>Заявка отправлена</Text>
                <Text style={styles.emailValue}>{r.workspaceName}</Text>
                <Text style={styles.cardText}>
                  Ждём подтверждения администратора. Когда заявку примут,
                  придёт письмо.
                </Text>
              </View>
            ))}
            {view.rejected.map((r) => (
              <View key={r.workspaceId} style={styles.emailCard}>
                <Text style={[styles.chip, styles.chipDanger]}>
                  Заявка отклонена
                </Text>
                <Text style={styles.emailValue}>{r.workspaceName}</Text>
                <Text style={styles.cardText}>
                  Клуб «{r.workspaceName}» отклонил заявку. Свяжитесь с клубом.
                </Text>
              </View>
            ))}
            <View style={styles.actions}>
              {view.pending.length > 0 && checkButton}
              {joinButton(false)}
              {signOutButton}
            </View>
          </>
        )
      case "wl-rejected":
        return (
          <>
            {icon("⚠️")}
            <Text style={styles.title}>Заявка отклонена</Text>
            <Text style={styles.subtitle}>
              Клуб отклонил заявку. Свяжитесь с клубом.
            </Text>
            <View style={styles.actions}>
              {joinButton(false)}
              {signOutButton}
            </View>
          </>
        )
      case "wl-missing":
        return (
          <>
            {icon("🔎")}
            <Text style={styles.title}>Заявка не найдена</Text>
            <Text style={styles.subtitle}>
              Мы не нашли вашу заявку в клуб. Выйдите и войдите снова — заявка
              создаётся при входе. Если не поможет, свяжитесь с клубом.
            </Text>
            <View style={styles.actions}>
              {joinButton(true)}
              {signOutButton}
            </View>
          </>
        )
      case "wl-pending":
        return (
          <>
            {icon("⏳")}
            <Text style={styles.title}>Ожидаем подтверждения</Text>
            <Text style={styles.subtitle}>
              Заявка в клуб отправлена. Как только администратор клуба её
              подтвердит, здесь откроются курсы, расписание и абонемент.
            </Text>

            {me ? (
              <View style={styles.emailCard}>
                <Text style={styles.emailLabel}>Ваш email для тренера</Text>
                <Text style={styles.emailValue} selectable>
                  {me.email}
                </Text>
              </View>
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}

            {me && (
              <Pressable
                onPress={() => setEditingName(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.nameBtn,
                  pressed && styles.btnPressed,
                ]}
              >
                {name ? (
                  <Text style={styles.nameText}>
                    {name} · <Text style={styles.nameLink}>Изменить</Text>
                  </Text>
                ) : (
                  <Text style={styles.nameLink}>Как вас зовут?</Text>
                )}
              </Pressable>
            )}

            <View style={styles.actions}>
              {checkButton}

              <Pressable
                onPress={handleShareEmail}
                disabled={!me}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.btnPressed,
                  !me && styles.btnDisabled,
                ]}
              >
                <Text style={styles.secondaryBtnText}>
                  Напомнить тренеру (поделиться email)
                </Text>
              </Pressable>

              {joinButton(false)}
              {signOutButton}
            </View>
          </>
        )
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <CenteredColumn>
        <ScrollView contentContainerStyle={styles.body}>
          {renderBody()}
        </ScrollView>
      </CenteredColumn>
      {editingName && me && (
        <EditNameModal
          me={me}
          onClose={() => setEditingName(false)}
          onSaved={(updated) => {
            setMe(updated)
            setEditingName(false)
          }}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    flexGrow: 1,
    padding: theme.spacing(6),
    justifyContent: "center",
    gap: theme.spacing(5),
  },
  icon: { fontSize: 56, textAlign: "center" },
  title: {
    ...theme.typography.title,
    fontSize: 26,
    color: theme.colors.text,
    textAlign: "center",
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  emailCard: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.lg,
    padding: theme.spacing(5),
    gap: theme.spacing(2),
    alignItems: "center",
  },
  emailLabel: { ...theme.typography.label },
  emailValue: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.text,
  },
  cardText: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  chip: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  chipDanger: { color: theme.colors.danger },
  nameBtn: { alignItems: "center", paddingVertical: theme.spacing(1) },
  nameText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  nameLink: { color: theme.colors.accent, fontSize: 15, fontWeight: "700" },
  actions: { gap: theme.spacing(2) },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing(4),
    borderRadius: theme.radius.full,
    alignItems: "center",
    ...theme.shadows.sm,
  },
  primaryBtnText: {
    color: theme.colors.accentText,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    paddingVertical: theme.spacing(4),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  signOutBtn: {
    paddingVertical: theme.spacing(3),
    alignItems: "center",
    marginTop: theme.spacing(2),
  },
  signOutText: { color: theme.colors.muted, fontSize: 13, fontWeight: "500" },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.5 },
})
