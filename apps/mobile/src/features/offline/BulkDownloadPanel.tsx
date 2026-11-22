import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { CONTROL_MAX_WIDTH } from "../../shared/useResponsive"
import {
  bulkResultMessage,
  combinedProgress,
  downloadedSummary,
} from "./bulk-download"
import type { BulkDownload } from "./use-bulk-download"

// The bulk download's button, «Скачано N из M», the run's combined progress
// with «Остановить», and the result. State lives in useBulkDownload.
export function BulkDownloadPanel({
  bulk,
  label,
  allDownloadedLabel,
  disabled = false,
}: {
  bulk: BulkDownload
  label: string
  allDownloadedLabel: string
  disabled?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const { state } = bulk
  const downloading = state.status === "downloading"
  const inactive = downloading || bulk.allDownloaded || disabled

  return (
    <View>
      <Pressable
        onPress={() => void bulk.start()}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive }}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          inactive && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>
          {bulk.allDownloaded ? allDownloadedLabel : label}
        </Text>
      </Pressable>

      {state.status === "downloading" ? (
        <View style={styles.progress}>
          <Text style={styles.muted}>
            {state.currentIndex + 1} из {state.totalVideos} · {state.videoPhase}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${combinedProgress(state) * 100}%` },
              ]}
            />
          </View>
          {state.stopping ? (
            <Text style={styles.muted}>Остановка после текущего видео…</Text>
          ) : (
            <Pressable
              onPress={bulk.stop}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.stop}>Остановить</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          {state.status === "done" && (
            <Text style={[styles.muted, styles.result]}>
              {bulkResultMessage(state)}
            </Text>
          )}
          {bulk.total > 0 && (
            <Text style={[styles.muted, styles.result]}>
              {downloadedSummary(bulk.local, bulk.total)}
            </Text>
          )}
        </>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      // A phone's full width; on a tablet a button, not a 700px slab.
      width: "100%",
      maxWidth: CONTROL_MAX_WIDTH,
      alignSelf: "flex-start",
      backgroundColor: theme.colors.text,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      marginTop: theme.spacing(3),
      ...theme.shadows.sm,
    },
    buttonText: {
      color: theme.colors.inverseText,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
    muted: { ...theme.typography.caption },
    progress: { gap: theme.spacing(1), marginTop: theme.spacing(2) },
    track: {
      height: 6,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.full,
      overflow: "hidden",
    },
    fill: {
      height: 6,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
    },
    result: { marginTop: theme.spacing(1) },
    stop: {
      color: theme.colors.danger,
      fontSize: 13,
      fontWeight: "600",
      marginTop: theme.spacing(1),
    },
  })
