import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
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
import { theme } from "../../shared/theme"

export function NoWorkspaceScreen() {
  const { signOut, refresh } = useAuth()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  const handleShareEmail = async () => {
    if (!me) return
    try {
      await Share.share({
        message: `Привет! Добавь меня в академию ${brand.displayName}, мой email: ${me.email}`,
      })
    } catch {
      /* noop */
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.icon}>⏳</Text>
        <Text style={styles.title}>Ожидаем подтверждения</Text>
        <Text style={styles.subtitle}>
          Заявка отправлена тренеру академии {brand.displayName}. Как только
          он её примет — здесь появятся курсы.
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

        <View style={styles.actions}>
          <Pressable
            onPress={() => void refresh()}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={styles.primaryBtnText}>Проверить ещё раз</Text>
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

          <Pressable onPress={signOut} hitSlop={8} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Выйти</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    flex: 1,
    padding: theme.spacing(6),
    justifyContent: "center",
    gap: theme.spacing(4),
  },
  icon: { fontSize: 48, textAlign: "center" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: theme.colors.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  emailCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(1),
    alignItems: "center",
  },
  emailLabel: {
    fontSize: 11,
    color: theme.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emailValue: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
  },
  actions: { gap: theme.spacing(2) },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  primaryBtnText: {
    color: theme.colors.accentText,
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  secondaryBtnText: { color: theme.colors.text, fontSize: 14 },
  signOutBtn: {
    paddingVertical: theme.spacing(2),
    alignItems: "center",
    marginTop: theme.spacing(2),
  },
  signOutText: { color: theme.colors.muted, fontSize: 13 },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.5 },
})
