import { downloadMenuActions, downloadStatusLine } from "./download-status"

describe("downloadStatusLine", () => {
  it("says nothing when there is no copy", () => {
    expect(downloadStatusLine({ status: "absent" }, false)).toBeNull()
    expect(downloadStatusLine({ status: "checking" }, false)).toBeNull()
  })

  it("shows a ready copy, its access date and when it is the one playing", () => {
    expect(downloadStatusLine({ status: "ready" }, false)?.text).toBe("Скачано")
    expect(
      downloadStatusLine({ status: "ready", accessUntil: "12.11.2026" }, true)?.text,
    ).toBe("Играет из загруженного · без интернета до 12.11.2026")
  })

  it("shows progress while downloading or paused", () => {
    expect(
      downloadStatusLine({ status: "downloading", progress: 0.456, phase: "Загрузка" }, false)
        ?.text,
    ).toBe("Загрузка · 46%")
    expect(
      downloadStatusLine({ status: "downloading", progress: 0, phase: "Подготовка…" }, false)
        ?.text,
    ).toBe("Подготовка…")
    expect(downloadStatusLine({ status: "paused", progress: 0.5 }, false)?.text).toBe(
      "Загрузка на паузе · 50%",
    )
  })

  it("reports a lost copy or a failure as an error", () => {
    expect(downloadStatusLine({ status: "error", message: "Нет сети" }, false)).toEqual({
      text: "Нет сети",
      tone: "danger",
    })
  })
})

describe("downloadMenuActions", () => {
  const native = { canDownload: true, controllable: false }
  const web = { canDownload: true, controllable: true }

  it("offers a download until there is a copy", () => {
    expect(downloadMenuActions({ status: "absent" }, native)).toEqual([
      { kind: "download", label: "Скачать", disabled: false },
    ])
    expect(
      downloadMenuActions({ status: "absent" }, { ...native, canDownload: false })[0]
        .disabled,
    ).toBe(true)
    expect(downloadMenuActions({ status: "checking" }, native)).toEqual([])
  })

  it("shows progress in place of the download while it runs", () => {
    const running = { status: "downloading", progress: 0.2, phase: "Загрузка" } as const
    expect(downloadMenuActions(running, native)).toEqual([
      { kind: "download", label: "Скачать", detail: "Загрузка · 20%", disabled: true },
    ])
    expect(downloadMenuActions(running, web).map((a) => a.kind)).toEqual(["pause", "cancel"])
  })

  it("resumes a paused download", () => {
    expect(
      downloadMenuActions({ status: "paused", progress: 0.3 }, web).map((a) => a.label),
    ).toEqual(["Продолжить загрузку", "Отменить загрузку"])
  })

  it("removes a ready copy, destructive", () => {
    expect(downloadMenuActions({ status: "ready" }, native)).toEqual([
      { kind: "remove", label: "Удалить загрузку", destructive: true },
    ])
  })
})
