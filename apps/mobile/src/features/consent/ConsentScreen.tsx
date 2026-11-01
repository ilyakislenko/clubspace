import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { MyConsent } from "../../shared/api/consent"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { showAlert } from "../../shared/alert"
import { deleteAccount } from "../../shared/api/me"
import { isConsentConflictError } from "../../shared/consent-errors"
import { errorMessage } from "../../shared/error-message"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { confirmDeleteAccount } from "../profile/confirm-delete-account"

const PROCESSED_DATA = [
  "email, имя, фамилия, телефон и другие данные профиля",
  "членство в клубах, посещаемость, абонементы и ранги",
  "записи дневника тренировок",
  "токены push-уведомлений и технические данные устройства",
]

/**
 * Blocking gate for the personal-data consent (152-ФЗ ст. 9). App.tsx renders
 * it in place of the whole app while `useAuth().consent` is set — after sign-in,
 * on a cold start with a stored session, and whenever the server starts
 * answering CONSENT_REQUIRED because a new edition was published.
 */
export function ConsentScreen({ consent }: { consent: MyConsent }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { acceptConsent, signOut } = useAuth()
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updated = consent.acceptedVersion !== null

  // A different edition (a 409 on accept, or a re-check) has to be read and
  // ticked again — the old tick was for the old text.
  useEffect(() => {
    setAgreed(false)
  }, [consent.currentVersion])

  // A brand-new account with nothing in it: refusing simply undoes the sign-up.
  const handleDecline = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await deleteAccount()
      signOut({ wipeLocal: true })
    } catch (e) {
      showAlert("Не удалось выйти", errorMessage(e))
      setSubmitting(false)
    }
  }

  const handleAccept = async () => {
    if (!agreed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await acceptConsent(consent.currentVersion)
    } catch (e) {
      setError(
        isConsentConflictError(e)
          ? "Текст согласия только что обновился. Ознакомьтесь с новой редакцией и примите её."
          : errorMessage(e, "Не удалось сохранить согласие. Попробуйте ещё раз."),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text
            style={styles.icon}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            // react-native-web ignores the two RN props above; aria-hidden is
            // what keeps a decorative emoji out of the screen-reader output.
            aria-hidden
          >
            📄
          </Text>
          <Text style={styles.title} accessibilityRole="header">
            {updated
              ? "Обновилось согласие на обработку данных"
              : "Согласие на обработку персональных данных"}
          </Text>
          <Text style={styles.subtitle}>
            {updated
              ? "Мы обновили текст согласия на обработку персональных данных. Чтобы продолжить, ознакомьтесь с новой редакцией и примите её."
              : `Чтобы пользоваться ${brand.displayName}, нужно ваше согласие на обработку персональных данных по закону 152-ФЗ.`}
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Что обрабатываем</Text>
            {PROCESSED_DATA.map((item) => (
              <Text key={item} style={styles.bullet}>
                • {item}
              </Text>
            ))}
            <Text style={styles.cardLabel}>Зачем</Text>
            <Text style={styles.cardText}>
              Чтобы вести вашу учётную запись и членство в клубе: расписание,
              посещаемость, абонементы, ранги и уведомления. Тренеры и
              администраторы клуба видят ваши данные только в пределах своего
              клуба.
            </Text>
          </View>

          <View style={styles.links}>
            <Pressable
              onPress={() => void Linking.openURL(brand.legal.consentUrl)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Текст согласия</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(brand.legal.privacyUrl)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Политика конфиденциальности</Text>
            </Pressable>
          </View>
          <Text style={styles.edition}>Редакция от {consent.currentVersion}</Text>

          <Pressable
            onPress={() => setAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={styles.checkRow}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>
              Я прочитал(а) текст согласия и даю согласие на обработку моих
              персональных данных
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={() => void handleAccept()}
            disabled={!agreed || submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !agreed || submitting, busy: submitting }}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
              (!agreed || submitting) && styles.btnDisabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.primaryBtnText}>Принимаю</Text>
            )}
          </Pressable>

          <Text style={styles.note}>
            {consent.isEmptyAccount
              ? "Без согласия пользоваться приложением нельзя. Если вы не согласны, аккаунт не будет создан. Отозвать согласие позже можно удалением аккаунта (Настройки → Удалить аккаунт)."
              : "Без согласия пользоваться приложением нельзя. Если вы не согласны, выйдите из аккаунта или удалите его. Отозвать согласие позже можно там же — удалением аккаунта (Настройки → Удалить аккаунт)."}
          </Text>

          <View style={styles.actions}>
            {consent.isEmptyAccount ? (
              <Pressable
                onPress={() => void handleDecline()}
                disabled={submitting}
                accessibilityRole="button"
                hitSlop={8}
                style={styles.ghostBtn}
              >
                <Text style={styles.signOutText}>Не согласен</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() =>
                  confirmDeleteAccount(() => signOut({ wipeLocal: true }))
                }
                accessibilityRole="button"
                hitSlop={8}
                style={styles.ghostBtn}
              >
                <Text style={styles.dangerText}>Удалить аккаунт</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => signOut()}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.ghostBtn}
            >
              <Text style={styles.signOutText}>Выйти</Text>
            </Pressable>
          </View>
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    flexGrow: 1,
    padding: theme.spacing(6),
    justifyContent: "center",
    gap: theme.spacing(4),
  },
  icon: { fontSize: 48, textAlign: "center" },
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
    textAlign: "center",
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  card: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.lg,
    padding: theme.spacing(5),
    gap: theme.spacing(2),
  },
  cardLabel: { ...theme.typography.label },
  cardText: { ...theme.typography.body, color: theme.colors.text },
  bullet: { ...theme.typography.body, color: theme.colors.text },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing(5),
  },
  link: {
    ...theme.typography.bodyStrong,
    color: theme.colors.accent,
    textDecorationLine: "underline",
  },
  edition: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  checkMark: {
    color: theme.colors.accentText,
    fontSize: 14,
    fontWeight: "800",
  },
  checkLabel: {
    ...theme.typography.body,
    flex: 1,
    color: theme.colors.text,
  },
  error: {
    ...theme.typography.body,
    color: theme.colors.danger,
    textAlign: "center",
  },
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
  btnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  btnDisabled: { opacity: 0.5 },
  note: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing(6),
  },
  ghostBtn: {
    paddingVertical: theme.spacing(2),
    alignItems: "center",
  },
  dangerText: { color: theme.colors.danger, fontSize: 13, fontWeight: "600" },
  signOutText: { color: theme.colors.muted, fontSize: 13, fontWeight: "500" },
})
