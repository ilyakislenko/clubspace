import { joinResultView } from "./join-result"

const res = (
  status: "active" | "pending" | "rejected",
  created: boolean,
) => ({ status, created, workspaceId: "w1", workspaceName: "Альфа" })

describe("joinResultView", () => {
  it("enters the club when active", () => {
    expect(joinResultView(res("active", true))).toEqual({
      action: "enter",
      toast: "Вы в клубе «Альфа»",
    })
    expect(joinResultView(res("active", false))).toEqual({
      action: "enter",
      toast: "Вы уже в клубе «Альфа»",
    })
  })

  it("confirms a new request", () => {
    const view = joinResultView(res("pending", true))
    expect(view).toMatchObject({
      action: "panel",
      tone: "success",
      title: "Заявка отправлена",
      primary: "Готово",
    })
    expect((view as { body: string }).body).toContain("«Альфа»")
  })

  it("says an existing request is still waiting", () => {
    expect(joinResultView(res("pending", false))).toMatchObject({
      action: "panel",
      tone: "info",
      title: "Заявка уже отправлена",
      primary: "Готово",
    })
  })

  it("tells a rejected applicant to contact the club", () => {
    const view = joinResultView(res("rejected", false))
    expect(view).toMatchObject({
      action: "panel",
      tone: "error",
      title: "Заявка отклонена",
      primary: "Ввести другой код",
    })
    expect((view as { body: string }).body).toBe(
      "Клуб «Альфа» отклонил заявку. Свяжитесь с клубом.",
    )
  })
})
