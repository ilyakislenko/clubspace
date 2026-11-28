import type { VideoAnswerCitation } from "../../shared/api/video-answers"
import { citationRoute, splitAnswer } from "./video-answer"

const cite = (n: number, over: Partial<VideoAnswerCitation> = {}): VideoAnswerCitation => ({
  n,
  videoId: `v${n}`,
  courseId: "c1",
  title: `Урок ${n}`,
  startAt: 95,
  endAt: 110,
  excerpt: "если держат голову",
  ...over,
})

describe("splitAnswer", () => {
  it("turns [n] into citation parts between the text", () => {
    const c1 = cite(1)
    const c2 = cite(2)
    expect(splitAnswer("Упритесь в бицепс [1] и сделайте мост [2][1].", [c1, c2])).toEqual([
      { kind: "text", text: "Упритесь в бицепс " },
      { kind: "citation", citation: c1 },
      { kind: "text", text: " и сделайте мост " },
      { kind: "citation", citation: c2 },
      { kind: "citation", citation: c1 },
      { kind: "text", text: "." },
    ])
  })

  it("drops a number with no citation and keeps plain text whole", () => {
    expect(splitAnswer("Мост [3].", [cite(1)])).toEqual([
      { kind: "text", text: "Мост " },
      { kind: "text", text: "." },
    ])
    expect(splitAnswer("Не нашлось.", [])).toEqual([{ kind: "text", text: "Не нашлось." }])
  })
})

describe("citationRoute", () => {
  it("opens the lesson at the cited moment, in its course when there is one", () => {
    expect(citationRoute(cite(1))).toEqual({
      videoId: "v1",
      courseId: "c1",
      title: "Урок 1",
      startAt: 95,
    })
    expect(citationRoute(cite(2, { courseId: null })).courseId).toBeUndefined()
  })
})
