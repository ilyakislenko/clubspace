import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import Constants from "expo-constants"
import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { environment } from "../../shared/env"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Profile">

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

export function ProfileScreen({}: Props) {
  const { workspace, signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchMe()
        if (cancelled) return
        setMe(data)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить профиль.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const fullName = me
    ? [me.firstname, me.lastname].filter(Boolean).join(" ") || "Не указано"
    : ""

  const reportUrl = `${environment.apiBaseUrl.replace(/\/$/, "")}/legal/report`
  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—"

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.body}>
        <Text style={styles.title}>Профиль</Text>

        {loading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : error || !me ? (
          <Text style={styles.errorText}>{error ?? "Профиль не найден."}</Text>
        ) : (
          <View style={styles.card}>
            <Field label="Email" value={me.email} mono />
            <Field label="Имя" value={fullName} />
            <Field label="Клуб" value={workspace?.name ?? "—"} />
            <Field label="С нами с" value={formatDate(me.createdAt)} />
          </View>
        )}

        <View style={styles.linksBlock}>
          <Pressable
            onPress={() =>
              void Linking.openURL("https://example.com/legal/privacy")
            }
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Политика конфиденциальности</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void Linking.openURL("https://example.com/legal/terms")
            }
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Условия использования</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(reportUrl)}
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Сообщить о нарушении</Text>
          </Pressable>
        </View>

        <Pressable onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Выйти</Text>
        </Pressable>

        <Text style={styles.muted}>Версия {appVersion}</Text>
      </View>
    </SafeAreaView>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    flex: 1,
    padding: theme.spacing(4),
    gap: theme.spacing(4),
  },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.text },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(3),
  },
  field: { gap: theme.spacing(1) },
  fieldLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    color: theme.colors.muted,
    letterSpacing: 0.5,
  },
  fieldValue: { fontSize: 15, color: theme.colors.text },
  mono: { fontFamily: "monospace" },
  linksBlock: { gap: theme.spacing(1) },
  linkRow: {
    paddingVertical: theme.spacing(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  linkText: { fontSize: 14, color: theme.colors.text },
  signOutButton: {
    paddingVertical: theme.spacing(3),
    alignItems: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  signOutText: { color: theme.colors.danger, fontSize: 15, fontWeight: "600" },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  muted: { textAlign: "center", color: theme.colors.muted, fontSize: 11 },
})
