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
  })
})
