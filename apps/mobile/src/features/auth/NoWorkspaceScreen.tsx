import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { shareFeedback, shareText } from "../../shared/share"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { EditNameModal } from "../profile/EditNameModal"
import { displayName } from "./switchable-workspaces"

export function NoWorkspaceScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { signOut, refresh } = useAuth()
  const { showToast } = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const mounted = useRef(true)
  const name = displayName(me)

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

  const handleCheck = async () => {
    if (checking) return
    setChecking(true)
    await refresh()
    // Approved: App swaps this screen out and it unmounts. Still here = pending.
    if (!mounted.current) return
    setChecking(false)
    showToast(
      "Заявка ещё не подтверждена — тренер или администратор клуба получил уведомление",
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

  return (
    <SafeAreaView style={styles.root}>
      <CenteredColumn>
      <View style={styles.body}>
        <Text
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // react-native-web ignores the two RN props above.
          aria-hidden
        >
          ⏳
        </Text>
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

          <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Выйти</Text>
          </Pressable>
        </View>
      </View>
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
    flex: 1,
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
