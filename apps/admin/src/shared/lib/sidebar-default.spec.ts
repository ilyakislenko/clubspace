import { defaultSidebarOpen, readSidebarCookie } from "./sidebar-default"

describe("readSidebarCookie", () => {
  it("reads the saved choice among other cookies", () => {
    expect(readSidebarCookie("theme=dark; sidebar_state=false; x=1")).toBe(false)
    expect(readSidebarCookie("sidebar_state=true")).toBe(true)
  })

  it("returns null when nothing was saved or the value is garbage", () => {
    expect(readSidebarCookie("")).toBeNull()
    expect(readSidebarCookie("theme=dark")).toBeNull()
    expect(readSidebarCookie("sidebar_state=maybe")).toBeNull()
  })

  it("does not match a cookie whose name only ends with sidebar_state", () => {
    expect(readSidebarCookie("old_sidebar_state=false")).toBeNull()
  })
})

describe("defaultSidebarOpen", () => {
  it("expands on a laptop and collapses on a tablet without a saved choice", () => {
    expect(defaultSidebarOpen("", 1280)).toBe(true)
    expect(defaultSidebarOpen("", 1440)).toBe(true)
    expect(defaultSidebarOpen("", 1279)).toBe(false)
    expect(defaultSidebarOpen("", 1024)).toBe(false)
  })

  it("keeps the saved choice regardless of the width", () => {
    expect(defaultSidebarOpen("sidebar_state=true", 1024)).toBe(true)
    expect(defaultSidebarOpen("sidebar_state=false", 1440)).toBe(false)
  })
})
