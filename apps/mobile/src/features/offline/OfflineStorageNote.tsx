/// <reference lib="dom" />
import React, { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { isWeb } from "../../shared/platform"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { formatBytes } from "./offline-budget"

type StorageFacts = {
  freeBytes: number | null
  persisted: boolean | null
  iosTab: boolean
}

// iPadOS reports itself as a Mac; touch points give it away.
const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

const isInstalled = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches === true ||
  // Safari's pre-standard flag for a home-screen launch.
  ("standalone" in navigator && navigator.standalone === true)

const readFacts = async (): Promise<StorageFacts> => {
  let freeBytes: number | null = null
  let persisted: boolean | null = null
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate?.quota !== undefined && estimate.usage !== undefined) {
      freeBytes = Math.max(0, estimate.quota - estimate.usage)
    }
    persisted = (await navigator.storage?.persisted?.()) ?? null
  } catch {
    /* StorageManager unavailable */
  }
  return { freeBytes, persisted, iosTab: isIos() && !isInstalled() }
}

/**
 * Browser-only facts under the "Загруженные" header: how much the origin may
 * still store, and — only when they apply — why the browser might drop the
 * downloads. Native storage is the app's own, so nothing renders there.
 */
export function OfflineStorageNote({ refreshKey }: { refreshKey: number }) {
  const styles = useThemedStyles(makeStyles)
  const [facts, setFacts] = useState<StorageFacts | null>(null)

  useEffect(() => {
    if (!isWeb) return
    void readFacts().then(setFacts)
  }, [refreshKey])

  if (!facts) return null
  const caveat = facts.iosTab
    ? "На iPhone и iPad Safari может стереть загрузки, если сайт не открывать 7 дней. Добавьте приложение на экран «Домой» (Поделиться → На экран «Домой») и скачивайте уроки оттуда."
    : facts.persisted === false
      ? "Браузер может удалить загрузки, если на устройстве закончится место. Установленное приложение хранит их надёжнее."
      : null

  return (
    <View style={styles.wrap}>
      {facts.freeBytes !== null && (
        <Text style={styles.text}>
          Браузер разрешает занять ещё ~{formatBytes(facts.freeBytes)}
        </Text>
      )}
      {caveat && <Text style={styles.text}>{caveat}</Text>}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      gap: theme.spacing(1),
      paddingHorizontal: theme.spacing(4),
      paddingTop: theme.spacing(2),
    },
    text: { color: theme.colors.muted, fontSize: 12 },
  })
