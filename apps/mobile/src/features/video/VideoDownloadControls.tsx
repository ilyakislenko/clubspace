import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

export type DownloadState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "downloading"; progress: number; phase: string }
  // Web: stopped by the member or by a dropped connection; resumable.
  | { status: "paused"; progress: number }
  | { status: "ready"; hint?: string }
  // Web: the stored copy can't be played any more (expired, revoked, evicted).
  | { status: "lost"; message: string }
  | { status: "error"; message: string }

type Props = {
  download: DownloadState
  // The streaming URL must be resolved before a download can start.
  canDownload: boolean
  onDownload: () => void
  onRemoveOffline: () => void
  // Only where downloads can be paused and cancelled (web).
  onPause?: () => void
  onCancel?: () => void
}

export function VideoDownloadControls({
  download,
  canDownload,
  onDownload,
  onRemoveOffline,
  onPause,
  onCancel,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  const secondary = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )

  const primary = (label: string, accessibilityLabel: string) => (
    <Pressable
      onPress={onDownload}
      disabled={!canDownload}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !canDownload }}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.buttonPressed,
        !canDownload && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )

  const progressBar = (progress: number, label: string) => (
    <View style={styles.downloadProgress}>
      <Text style={styles.downloadLabel}>{label}</Text>
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${Math.round(progress * 100)}%` },
          ]}
        />
      </View>
    </View>
  )

  return (
    <>
      <View style={styles.downloadRow}>
        {download.status === "ready" ? (
          <>
            <View style={styles.downloadProgress}>
              <Text style={styles.downloadLabel}>✓ Скачано для офлайн</Text>
              {download.hint ? (
                <Text style={styles.hint}>{download.hint}</Text>
              ) : null}
            </View>
            {secondary("Удалить", onRemoveOffline)}
          </>
        ) : download.status === "downloading" ? (
          <>
            {progressBar(
              download.progress,
              download.progress > 0
                ? `${download.phase} · ${Math.round(download.progress * 100)}%`
                : download.phase,
            )}
            {onPause && onCancel ? (
              <View style={styles.buttons}>
                {secondary("Пауза", onPause)}
                {secondary("Отмена", onCancel)}
              </View>
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}
          </>
        ) : download.status === "paused" ? (
          <>
            {progressBar(
              download.progress,
              `На паузе · ${Math.round(download.progress * 100)}%`,
            )}
            <View style={styles.buttons}>
              {primary("Продолжить", "Продолжить загрузку")}
              {onCancel && secondary("Отмена", onCancel)}
            </View>
          </>
        ) : download.status === "lost" ? (
          <>
            <Text style={[styles.downloadLabel, styles.flex]}>
              {download.message}
            </Text>
            {primary("Скачать снова", "Скачать урок снова")}
          </>
        ) : (
          <>
            <Text style={styles.downloadLabel}>Доступ без интернета</Text>
            {primary("Скачать", "Скачать для просмотра без интернета")}
          </>
        )}
      </View>
      {download.status === "error" && (
        <Text style={styles.errorText}>{download.message}</Text>
      )}
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(4),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing(2),
    ...theme.shadows.sm,
  },
  flex: { flex: 1 },
  downloadProgress: { flex: 1, gap: theme.spacing(1) },
  downloadLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.text,
  },
  hint: { color: theme.colors.muted, fontSize: 12 },
  buttons: { flexDirection: "row", gap: theme.spacing(2) },
  progressBarTrack: {
    height: 6,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.full,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    ...theme.shadows.sm,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
})
