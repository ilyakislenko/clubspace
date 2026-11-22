// The lesson's offline copy as the lesson screen shows it: a quiet status
// line (only while there is something to say) and the actions of its «⋯»
// menu. Pure, so both are unit-tested.

export type DownloadState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "downloading"; progress: number; phase: string }
  // Web: stopped by the member or by a dropped connection; resumable.
  | { status: "paused"; progress: number }
  // `accessUntil`: the date offline access ends (renewed while online).
  | { status: "ready"; accessUntil?: string }
  // Web: the stored copy can't be played any more (expired, revoked, evicted).
  | { status: "lost"; message: string }
  | { status: "error"; message: string }

const percent = (progress: number) => `${Math.round(progress * 100)}%`

const progressText = (d: { progress: number; phase: string }) =>
  d.progress > 0 ? `${d.phase} · ${percent(d.progress)}` : d.phase

export type DownloadStatusLine = { text: string; tone: "muted" | "danger" }

/** The line under the lesson's actions; null = nothing worth a line. */
export const downloadStatusLine = (
  d: DownloadState,
  playingOffline: boolean,
): DownloadStatusLine | null => {
  switch (d.status) {
    case "ready": {
      const head = playingOffline ? "Играет из загруженного" : "Скачано"
      return {
        text: d.accessUntil ? `${head} · без интернета до ${d.accessUntil}` : head,
        tone: "muted",
      }
    }
    case "downloading":
      return { text: progressText(d), tone: "muted" }
    case "paused":
      return { text: `Загрузка на паузе · ${percent(d.progress)}`, tone: "muted" }
    case "lost":
    case "error":
      return { text: d.message, tone: "danger" }
    case "absent":
    case "checking":
      return null
  }
}

export type DownloadAction = {
  kind: "download" | "pause" | "cancel" | "remove"
  label: string
  detail?: string
  disabled?: boolean
  destructive?: boolean
}

/**
 * The download rows of the lesson's «⋯» menu. `canDownload`: a stream to
 * download from is resolved; `controllable`: downloads can be paused and
 * cancelled (web).
 */
export const downloadMenuActions = (
  d: DownloadState,
  { canDownload, controllable }: { canDownload: boolean; controllable: boolean },
): DownloadAction[] => {
  const cancel: DownloadAction[] = controllable
    ? [{ kind: "cancel", label: "Отменить загрузку", destructive: true }]
    : []
  switch (d.status) {
    case "absent":
    case "error":
      return [{ kind: "download", label: "Скачать", disabled: !canDownload }]
    case "checking":
      return []
    case "downloading":
      return controllable
        ? [
            { kind: "pause", label: "Приостановить загрузку", detail: progressText(d) },
            ...cancel,
          ]
        : [{ kind: "download", label: "Скачать", detail: progressText(d), disabled: true }]
    case "paused":
      return [
        {
          kind: "download",
          label: "Продолжить загрузку",
          detail: `На паузе · ${percent(d.progress)}`,
          disabled: !canDownload,
        },
        ...cancel,
      ]
    case "lost":
      return [{ kind: "download", label: "Скачать снова", disabled: !canDownload }]
    case "ready":
      return [{ kind: "remove", label: "Удалить загрузку", destructive: true }]
  }
}
