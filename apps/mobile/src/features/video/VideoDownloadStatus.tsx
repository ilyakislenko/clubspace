import React from "react"
import { StyleSheet, Text } from "react-native"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { downloadStatusLine, type DownloadState } from "./download-status"

// The lesson's offline copy in one quiet line — «Скачано», the progress, or
// what went wrong — and nothing while there's no copy. The actions live in
// the lesson's «⋯» menu.
export function VideoDownloadStatus({
  download,
  playingOffline,
}: {
  download: DownloadState
  playingOffline: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const line = downloadStatusLine(download, playingOffline)
  if (!line) return null
  return (
    <Text
      style={line.tone === "danger" ? styles.danger : styles.muted}
      accessibilityLiveRegion="polite"
    >
      {line.text}
    </Text>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  muted: { ...theme.typography.caption },
  danger: { ...theme.typography.caption, color: theme.colors.danger },
})
