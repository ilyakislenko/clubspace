import React from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"

import { theme } from "../../shared/theme"

export type DownloadState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "downloading"; progress: number; phase: string }
  | { status: "ready" }
  | { status: "error"; message: string }

type Props = {
  download: DownloadState
  // The streaming URL must be resolved before a download can start.
  canDownload: boolean
  onDownload: () => void
  onRemoveOffline: () => void
}

export function VideoDownloadControls({
  download,
  canDownload,
  onDownload,
  onRemoveOffline,
}: Props) {
  return (
    <>
      <View style={styles.downloadRow}>
        {download.status === "ready" ? (
          <>
            <Text style={styles.downloadLabel}>✓ Скачано для офлайн</Text>
            <Pressable onPress={onRemoveOffline} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Удалить</Text>
            </Pressable>
          </>
        ) : download.status === "downloading" ? (
          <>
            <View style={styles.downloadProgress}>
              <Text style={styles.downloadLabel}>
                {download.phase}{" "}
                {download.progress > 0 &&
                  `· ${Math.round(download.progress * 100)}%`}
              </Text>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(download.progress * 100)}%` },
                  ]}
                />
              </View>
            </View>
            <ActivityIndicator color={theme.colors.accent} />
          </>
        ) : (
          <>
            <Text style={styles.downloadLabel}>Доступ без интернета</Text>
            <Pressable
              onPress={onDownload}
              disabled={!canDownload}
              accessibilityRole="button"
              accessibilityLabel="Скачать для просмотра без интернета"
              accessibilityState={{ disabled: !canDownload }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                !canDownload && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>Скачать</Text>
            </Pressable>
          </>
        )}
      </View>
      {download.status === "error" && (
        <Text style={styles.errorText}>{download.message}</Text>
      )}
    </>
  )
}

const styles = StyleSheet.create({
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
  downloadProgress: { flex: 1, gap: theme.spacing(1) },
  downloadLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.text,
  },
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
