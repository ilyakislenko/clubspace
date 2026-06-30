import React, { useEffect, useState } from "react"
import {
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

const formatDate = (iso?: string | null) => {
  if (!iso) return null
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function AccessExpiredScreen() {
  const styles = useThemedStyles(makeStyles)
  const { signOut, refresh, workspace } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const expiredOn = formatDate(workspace?.accessUntil)

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  const handleShareEmail = async () => {
    if (!me) return
    try {
      await Share.share({
        message: `Привет! Продли мне доступ в академию ${brand.displayName}, мой email: ${me.email}`,
      })
    } catch {
      /* noop */
    }
  }

  const handleEmailSupport = () => {
    void Linking.openURL(`mailto:${brand.legal.supportEmail}`)
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          🔒
        </Text>
        <Text style={styles.title}>Доступ закончился</Text>
        <Text style={styles.subtitle}>
          Подписка в академию {brand.displayName} истекла
          {expiredOn ? ` ${expiredOn}` : ""}. Чтобы продолжить смотреть курсы,
          обратитесь к тренеру.
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
            onPress={() => void refresh()}
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={styles.ghostBtnText}>Я уже продлил — обновить</Text>
          </Pressable>

          <Pressable onPress={signOut} hitSlop={8} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Выйти</Text>
          </Pressable>
        </View>
      </View>
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
