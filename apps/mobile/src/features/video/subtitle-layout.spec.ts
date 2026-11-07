import {
  choiceFromTrack,
  parseSubtitleChoice,
  pickSubtitleTrack,
  subtitleMenuOptions,
} from "./subtitle-choice"
import {
  nextSubtitleFontStep,
  SUBTITLE_FONT_STEPS,
  subtitleMaxWidth,
} from "./subtitle-layout"

describe("nextSubtitleFontStep", () => {
  it("keeps a cue of up to three lines as it is", () => {
    expect(nextSubtitleFontStep(3, 0)).toBeNull()
    expect(nextSubtitleFontStep(1, 1)).toBeNull()
  })

  it("shrinks a longer cue one step at a time", () => {
    expect(nextSubtitleFontStep(4, 0)).toBe(1)
    expect(nextSubtitleFontStep(4, 1)).toBe(2)
  })

  it("stops at the smallest readable size", () => {
    expect(nextSubtitleFontStep(5, SUBTITLE_FONT_STEPS.length - 1)).toBeNull()
  })
})

it("caps a cue's width to part of the picture", () => {
  expect(subtitleMaxWidth(1000)).toBe(860)
  expect(subtitleMaxWidth(-5)).toBe(0)
})

describe("pickSubtitleTrack", () => {
  const en = { id: "en", language: "en", label: "English", isDefault: true }
  const ruAuto = { id: "ru-auto", language: "ru", label: "Русский (авто)", isDefault: false }
  const ru = { id: "ru", language: "ru", label: "Русский", isDefault: false }

  it("opens on the default track until the member chooses", () => {
    expect(pickSubtitleTrack([ruAuto, en], null)?.id).toBe("en")
    expect(pickSubtitleTrack([ruAuto], null)?.id).toBe("ru-auto")
    expect(pickSubtitleTrack([], null)).toBeNull()
  })

  it("keeps Off off", () => {
    expect(pickSubtitleTrack([en, ruAuto], { kind: "off" })).toBeNull()
  })

  it("picks the chosen track by label, else by language", () => {
    const choice = choiceFromTrack(ruAuto)
    expect(pickSubtitleTrack([en, ru, ruAuto], choice)?.id).toBe("ru-auto")
    expect(pickSubtitleTrack([en, ru], choice)?.id).toBe("ru")
  })

  it("falls back to the default in a lesson without that language", () => {
    expect(pickSubtitleTrack([en], choiceFromTrack(ruAuto))?.id).toBe("en")
  })
})

describe("parseSubtitleChoice", () => {
  it("reads back stored choices", () => {
    expect(parseSubtitleChoice(choiceFromTrack(null))).toEqual({ kind: "off" })
    expect(
      parseSubtitleChoice({ kind: "track", language: "ru", label: "Русский (авто)" }),
    ).toEqual({ kind: "track", language: "ru", label: "Русский (авто)" })
  })

  it("treats anything else as no choice", () => {
    expect(parseSubtitleChoice(null)).toBeNull()
    expect(parseSubtitleChoice({ kind: "track", language: 1 })).toBeNull()
    expect(parseSubtitleChoice("ru")).toBeNull()
  })
})

describe("subtitleMenuOptions", () => {
  it("offers Off first and names automatic tracks by their language", () => {
    expect(
      subtitleMenuOptions([
        { id: "ru", label: "Русский (авто)" },
        { id: "en", label: "English (авто)" },
      ]),
    ).toEqual([
      { id: null, label: "Выкл" },
      { id: "ru", label: "Русский" },
      { id: "en", label: "English" },
    ])
  })

  it("keeps the suffix where two tracks would read the same", () => {
    expect(
      subtitleMenuOptions([
        { id: "ru", label: "Русский" },
        { id: "ru-auto", label: "Русский (авто)" },
      ]).map((o) => o.label),
    ).toEqual(["Выкл", "Русский", "Русский (авто)"])
  })
})
