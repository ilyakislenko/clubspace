import { pluralRu } from "../../../shared/lib/plural-ru"
import type { VideoTextStatus } from "../../../shared/api/videos"

// Badges and summaries for what the video worker made from a lesson.

const CHAPTER_SOURCES: Record<string, string> = {
  manual: "Вручную",
  ocr: "С экрана",
  speech: "Из речи",
}

const SUBTITLE_SOURCES: Record<string, string> = {
  manual: "Загружены",
  auto: "Авто",
}

/** «Вручную» / «С экрана» (titles on screen) / «Из речи». */
export const chapterSourceLabel = (source: string): string =>
  CHAPTER_SOURCES[source] ?? source

/** «Загружены» (by staff) / «Авто» (made from speech). */
export const subtitleSourceLabel = (source: string): string =>
  SUBTITLE_SOURCES[source] ?? source

export const isAutoChapter = (source: string) => source === "ocr" || source === "speech"
export const isAutoSubtitle = (source: string) => source === "auto"

/** Badge colours: the worker's rows stand out from staff's. */
export const sourceBadgeClass = (auto: boolean): string =>
  auto
    ? "bg-primary/10 text-primary ring-primary/30"
    : "bg-muted text-muted-foreground ring-border"

/** «Расшифровка: en, 312 фраз, перевод на русский есть» or why there's none. */
export const transcriptSummary = (status: VideoTextStatus): string => {
  const t = status.transcript
  if (!t) {
    return status.videoStatus === "ready"
      ? "Расшифровки нет — речь ещё не распознана."
      : "Расшифровка появится после обработки видео."
  }
  const language = t.language === "und" ? "язык не определён" : t.language
  const phrases = `${t.segmentCount} ${pluralRu(t.segmentCount, "фраза", "фразы", "фраз")}`
  const ru = t.translatedRu ? "перевод на русский есть" : "перевода на русский нет"
  return `Расшифровка: ${language}, ${phrases}, ${ru}.`
}

/** What «Пересоздать» is doing right now, or null when nothing is queued. */
export const regenerationLabel = (status: VideoTextStatus): string | null =>
  status.regeneration === "active"
    ? "Пересоздаём главы и субтитры…"
    : status.regeneration === "waiting"
      ? "В очереди на пересоздание…"
      : null
