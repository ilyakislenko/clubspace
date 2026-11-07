import type { VideoTextStatus } from "../../../shared/api/videos"
import {
  chapterSourceLabel,
  isAutoChapter,
  isAutoSubtitle,
  regenerationLabel,
  sourceBadgeClass,
  subtitleSourceLabel,
  transcriptSummary,
} from "./video-text-labels"

const status = (over: Partial<VideoTextStatus> = {}): VideoTextStatus => ({
  videoStatus: "ready",
  chaptersScannedAt: null,
  transcript: null,
  chapters: { manual: 0, auto: 0 },
  subtitles: { manual: 0, auto: 0 },
  regeneration: null,
  ...over,
})

describe("video text labels", () => {
  it("names chapter and subtitle sources", () => {
    expect(chapterSourceLabel("manual")).toBe("Вручную")
    expect(chapterSourceLabel("ocr")).toBe("С экрана")
    expect(chapterSourceLabel("speech")).toBe("Из речи")
    expect(chapterSourceLabel("other")).toBe("other")
    expect(subtitleSourceLabel("auto")).toBe("Авто")
    expect(subtitleSourceLabel("manual")).toBe("Загружены")
    expect(subtitleSourceLabel("x")).toBe("x")
  })

  it("tells the worker's rows from staff's", () => {
    expect(isAutoChapter("ocr") && isAutoChapter("speech")).toBe(true)
    expect(isAutoChapter("manual")).toBe(false)
    expect(isAutoSubtitle("auto")).toBe(true)
    expect(isAutoSubtitle("manual")).toBe(false)
    expect(sourceBadgeClass(true)).toContain("text-primary")
    expect(sourceBadgeClass(false)).toContain("text-muted-foreground")
  })

  it("summarizes the transcript", () => {
    expect(transcriptSummary(status())).toBe("Расшифровки нет — речь ещё не распознана.")
    expect(transcriptSummary(status({ videoStatus: "processing" }))).toBe(
      "Расшифровка появится после обработки видео.",
    )
    expect(
      transcriptSummary(
        status({
          transcript: {
            language: "en",
            segmentCount: 312,
            translatedRu: true,
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("Расшифровка: en, 312 фраз, перевод на русский есть.")
    expect(
      transcriptSummary(
        status({
          transcript: {
            language: "und",
            segmentCount: 1,
            translatedRu: false,
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("Расшифровка: язык не определён, 1 фраза, перевода на русский нет.")
  })

  it("describes a pending regeneration", () => {
    expect(regenerationLabel(status())).toBeNull()
    expect(regenerationLabel(status({ regeneration: "waiting" }))).toBe("В очереди на пересоздание…")
    expect(regenerationLabel(status({ regeneration: "active" }))).toBe(
      "Пересоздаём главы и субтитры…",
    )
  })
})
