import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useRef, useState } from "react"

import { showAlert } from "../../shared/alert"
import { getVideo } from "../../shared/api/videos"
import { errorMessage } from "../../shared/error-message"
import {
  missingTargets,
  localCount,
  phaseFraction,
  phaseLabel,
  type BulkDownloadTarget,
} from "./bulk-download"
import { canDownloadNow, networkPolicyMessage } from "./network-policy"
import {
  downloadVideoForOffline,
  listOfflineEntries,
  offlineDownloadControls,
} from "./offline-store"
import { OfflineDownloadInterrupted } from "./offline-types"

export type BulkDownloadState =
  | { status: "idle" }
  | {
      status: "downloading"
      currentIndex: number
      totalVideos: number
      videoPhase: string
      // The running lesson, 0..1 (combinedProgress).
      videoFraction: number
      // Stop pressed; native finishes the running lesson first.
      stopping: boolean
    }
  | {
      status: "done"
      downloaded: number
      skipped: number
      // Why the first skipped lesson failed (e.g. not enough space).
      reason: string | null
    }

/** The confirm/«nothing to do» alerts, worded for what is being downloaded. */
export type BulkDownloadCopy = {
  confirmTitle: string
  allDoneTitle: string
  allDoneMessage: string
}

export type BulkDownload = {
  /** Lessons with a ready local copy (any, not only the targets). */
  offlineSet: ReadonlySet<string>
  state: BulkDownloadState
  /** The lessons on offer. */
  total: number
  /** How many of them are already on the device. */
  local: number
  allDownloaded: boolean
  /** Checks the network policy, confirms and runs. */
  start: () => Promise<void>
  stop: () => void
  /** Re-reads which lessons are on the device (after deleting copies). */
  refresh: () => void
}

/**
 * «Скачать для тренировки»: downloads every missing lesson of `targets` one by
 * one, under the network policy (Wi-Fi only). The storage budget is the
 * store's per-lesson check — a lesson that doesn't fit is skipped with its
 * reason. Lessons already on the device are skipped. Stop cancels the running
 * lesson where the store can (web); native finishes it, then stops.
 * `targets` must be memoized and free of duplicates (uniqueTargets).
 */
export function useBulkDownload(params: {
  workspaceId: string | null
  targets: readonly BulkDownloadTarget[]
  copy: BulkDownloadCopy
}): BulkDownload {
  const { workspaceId, targets, copy } = params
  const [offlineSet, setOfflineSet] = useState<ReadonlySet<string>>(new Set())
  const [state, setState] = useState<BulkDownloadState>({ status: "idle" })
  const stopRef = useRef(false)
  const currentRef = useRef<string | null>(null)

  const refreshLocal = useCallback(() => {
    void listOfflineEntries().then((list) =>
      setOfflineSet(
        new Set(list.filter((e) => e.status === "ready").map((e) => e.videoId)),
      ),
    )
  }, [])
  // A lesson downloaded (or deleted) elsewhere shows on return.
  useFocusEffect(refreshLocal)
  useEffect(refreshLocal, [refreshLocal, targets])

  const run = async (videos: BulkDownloadTarget[]) => {
    if (!workspaceId) return
    stopRef.current = false
    let downloaded = 0
    let skipped = 0
    let reason: string | null = null
    for (let i = 0; i < videos.length; i++) {
      if (stopRef.current) break
      const target = videos[i]
      currentRef.current = target.videoId
      const report = (videoPhase: string, videoFraction: number) =>
        setState({
          status: "downloading",
          currentIndex: i,
          totalVideos: videos.length,
          videoPhase,
          videoFraction,
          stopping: stopRef.current,
        })
      report("подготовка", 0)
      try {
        // The detail is what the player shows offline (getCachedVideo).
        const video = await getVideo({ workspaceId, videoId: target.videoId })
        await downloadVideoForOffline({
          videoId: target.videoId,
          video,
          course: target.course,
          thumbnailUrl: target.thumbnailUrl,
          onProgress: (p) => report(phaseLabel(p), phaseFraction(p)),
        })
        downloaded += 1
        setOfflineSet((prev) => new Set(prev).add(target.videoId))
      } catch (err) {
        if (err instanceof OfflineDownloadInterrupted) break
        skipped += 1
        reason ??= errorMessage(err, "Не удалось скачать.")
      }
    }
    currentRef.current = null
    setState({ status: "done", downloaded, skipped, reason })
    setTimeout(() => setState({ status: "idle" }), reason ? 8_000 : 4_000)
  }

  const start = async () => {
    if (!workspaceId || state.status === "downloading") return
    const policy = await canDownloadNow()
    if (!policy.ok) {
      showAlert("Загрузка недоступна", networkPolicyMessage(policy.reason))
      return
    }
    const missing = missingTargets(targets, offlineSet)
    if (missing.length === 0) {
      showAlert(copy.allDoneTitle, copy.allDoneMessage)
      return
    }
    showAlert(
      copy.confirmTitle,
      `Будет скачано видео: ${missing.length}. Это может занять время и место на устройстве.`,
      [
        { text: "Отмена", style: "cancel" },
        { text: "Скачать", onPress: () => void run(missing) },
      ],
    )
  }

  // Lessons finished so far stay; on web the running one is discarded.
  const stop = () => {
    stopRef.current = true
    setState((prev) =>
      prev.status === "downloading" ? { ...prev, stopping: true } : prev,
    )
    const current = currentRef.current
    if (current) void offlineDownloadControls?.cancel(current)
  }

  const local = localCount(targets, offlineSet)
  return {
    offlineSet,
    state,
    total: targets.length,
    local,
    allDownloaded: targets.length > 0 && local === targets.length,
    start,
    stop,
    refresh: refreshLocal,
  }
}
