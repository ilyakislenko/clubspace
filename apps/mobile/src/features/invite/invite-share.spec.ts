import { inviteShareMessage } from "./invite-share"

describe("inviteShareMessage", () => {
  it("names the club, the link and the code", () => {
    expect(
      inviteShareMessage({
        workspaceName: "Академия",
        joinUrl: "https://app.example/join/ABCD2345",
        joinCodeDisplay: "ABCD-2345",
      }),
    ).toBe(
      "Присоединяйтесь к клубу «Академия» в ClubSpace: https://app.example/join/ABCD2345\nКод клуба: ABCD-2345",
    )
  })
})
