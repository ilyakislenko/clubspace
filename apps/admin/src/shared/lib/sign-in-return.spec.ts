import { afterSignInPath, signInHref } from "./sign-in-return"

describe("sign-in return", () => {
  it("remembers the page a lapsed session was on", () => {
    expect(signInHref("/sign-up")).toBe("/sign-in?next=%2Fsign-up")
    expect(signInHref("/workspace/w1/members?tab=all")).toBe(
      "/sign-in?next=%2Fworkspace%2Fw1%2Fmembers%3Ftab%3Dall",
    )
    expect(signInHref("/")).toBe("/sign-in")
    expect(signInHref("/sign-in?email=a@b")).toBe("/sign-in")
  })

  it("returns /sign-up to the club form, anything foreign to the club list", () => {
    expect(afterSignInPath("/sign-up")).toBe("/sign-up")
    expect(afterSignInPath("/workspace/w1/members?tab=all")).toBe(
      "/workspace/w1/members?tab=all",
    )
    expect(afterSignInPath(null)).toBe("/workspaces")
    expect(afterSignInPath("")).toBe("/workspaces")
    expect(afterSignInPath("//evil.example")).toBe("/workspaces")
    expect(afterSignInPath("/\\evil.example")).toBe("/workspaces")
    expect(afterSignInPath("https://evil.example")).toBe("/workspaces")
    expect(afterSignInPath("/sign-in")).toBe("/workspaces")
    expect(afterSignInPath("/sign-in?next=%2Fx")).toBe("/workspaces")
  })

  it("never leaves for another host, however `next` is spelled", () => {
    // As the sign-in page reads it: ?next= decoded by URLSearchParams.
    const fromQuery = (raw: string) =>
      afterSignInPath(new URLSearchParams(`next=${raw}`).get("next"))
    for (const raw of [
      "/%09/evil.example",
      "/%0A/evil.example",
      "/%0D/evil.example",
      "/%09%5Cevil.example",
      "/%0A%5C%5Cevil.example",
      "%2F%2Fevil.example",
      "/%5Cevil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/a/..//evil.example",
    ]) {
      expect(fromQuery(raw)).toBe("/workspaces")
    }
    expect(afterSignInPath("/\t/evil")).toBe("/workspaces")
    expect(afterSignInPath("/\n\\evil")).toBe("/workspaces")
    expect(afterSignInPath("//evil")).toBe("/workspaces")
    expect(afterSignInPath("/\\evil")).toBe("/workspaces")
    expect(afterSignInPath("https://evil")).toBe("/workspaces")
    expect(afterSignInPath("javascript:alert(1)")).toBe("/workspaces")
    // A path of this app keeps its query and hash.
    expect(fromQuery("%2Fworkspace%2Fw1%3Ftab%3Dall%23top")).toBe(
      "/workspace/w1?tab=all#top",
    )
  })
})
