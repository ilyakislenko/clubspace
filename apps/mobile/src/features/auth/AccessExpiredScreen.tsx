import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { shareFeedback, shareText } from "../../shared/share"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { switchableWorkspaces } from "./switchable-workspaces"

const formatDate = (iso?: string | null) => {
  if (!iso) return null
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function AccessExpiredScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { signOut, refresh, workspace, workspaces, switchWorkspace } = useAuth()
  const { showToast } = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  const expiredOn = formatDate(workspace?.accessUntil)
  const otherClubs = switchableWorkspaces(workspaces, workspace?.workspaceId)

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
    // Renewed: App swaps this screen out and it unmounts. Still here = expired.
    if (!mounted.current) return
    setChecking(false)
    showToast(
      "Доступ ещё не продлён. Если вы уже оплатили, напишите администратору клуба.",
    )
  }

  const handleShareEmail = async () => {
    if (!me) return
    // A locked-out member's main way out of this screen — never a no-op.
    const feedback = shareFeedback(
      await shareText({
        message: `Привет! Продли мне доступ в клуб${workspace ? ` ${workspace.name}` : ""}, мой email: ${me.email}`,
      }),
    )
    if (feedback) showToast(feedback)
  }

  const handleEmailSupport = () => {
    void Linking.openURL(`mailto:${brand.legal.supportEmail}`)
  }

  return (
    <SafeAreaView style={styles.root}>
      <CenteredColumn>
      <View style={styles.body}>
        <Text
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // react-native-web ignores the two RN props above; aria-hidden is
          // what keeps a decorative emoji out of the screen-reader output.
          aria-hidden
        >
          🔒
        </Text>
        <Text style={styles.title}>Доступ закончился</Text>
        <Text style={styles.subtitle}>
          Доступ в {workspace ? workspace.name : "клуб"} истёк
          {expiredOn ? ` ${expiredOn}` : ""}. Чтобы продолжить, обратитесь к
          тренеру или администратору клуба.
        </Text>

        {me && (
          <View style={styles.emailCard}>
            <Text style={styles.emailLabel}>Ваш email</Text>
            <Text style={styles.emailValue} selectable>
              {me.email}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Pressable
            onPress={handleShareEmail}
            disabled={!me}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
              !me && styles.btnDisabled,
            ]}
          >
            <Text style={styles.primaryBtnText}>Написать тренеру</Text>
          </Pressable>

          <Pressable
            onPress={handleEmailSupport}
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={styles.secondaryBtnText}>
              Связаться с поддержкой
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void handleCheck()}
            disabled={checking}
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed && styles.btnPressed,
            ]}
          >
            {checking ? (
              <ActivityIndicator color={theme.colors.muted} />
            ) : (
              <Text style={styles.ghostBtnText}>Обновить статус</Text>
            )}
          </Pressable>

          {otherClubs.length > 0 && (
            <View style={styles.clubs}>
              <Text style={styles.emailLabel}>Другие клубы</Text>
              {otherClubs.map((w) => (
                <Pressable
                  key={w.workspaceId}
                  onPress={() => switchWorkspace(w.workspaceId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Перейти в клуб ${w.name}`}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>{w.name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Выйти</Text>
          </Pressable>
        </View>
      </View>
      </CenteredColumn>
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
  clubs: { gap: theme.spacing(2), marginTop: theme.spacing(2) },
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
  ghostBtn: {
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  ghostBtnText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  signOutBtn: {
    paddingVertical: theme.spacing(2),
    alignItems: "center",
    marginTop: theme.spacing(2),
  },
  signOutText: { color: theme.colors.muted, fontSize: 13, fontWeight: "500" },
  btnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  btnDisabled: { opacity: 0.5 },
})
