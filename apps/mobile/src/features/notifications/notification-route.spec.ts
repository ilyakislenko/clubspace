import {
  openNotificationRoute,
  routeForNotification,
} from "./notification-route"

const on = () => true
const off = () => false

describe("routeForNotification", () => {
  it.each([
    [{ kind: "rank.promoted" }, "MyRanks"],
    [{ kind: "grading.candidate" }, "MyRanks"],
    [{ kind: "achievement.unlocked" }, "Achievements"],
    [{ kind: "announcement.published" }, "Announcements"],
    [{ kind: "member.inactive" }, "MyAttendance"],
    [{ kind: "classes.low" }, "MySubscription"],
    [{ kind: "classes.exhausted" }, "MySubscription"],
    [{ kind: "access.expiring" }, "MySubscription"],
    [{ kind: "subscription.first_visit_pending" }, "MySubscription"],
    [{ kind: "subscription.payment_due" }, "MySubscription"],
    [{ kind: "freeze.approved" }, "MySubscription"],
    [{ kind: "freeze.declined" }, "MySubscription"],
    [{ kind: "event.reminder" }, "Events"],
    [{ kind: "retention.digest" }, "AtRiskMembers"],
  ])("%j -> %s", (metadata, name) => {
    expect(routeForNotification(metadata, on)).toEqual({ name })
  })

  it("freeze.requested opens that member's abonement, or nothing without the id", () => {
    expect(
      routeForNotification(
        { kind: "freeze.requested", freezeRequestId: "r1", memberUserId: "u1" },
        on,
      ),
    ).toEqual({ name: "MemberSubscription", params: { userId: "u1" } })
    expect(routeForNotification({ kind: "freeze.requested" }, on)).toBeNull()
  })

  it("freeze.approved / freeze.declined open nothing while the abonement section is off", () => {
    expect(routeForNotification({ kind: "freeze.approved" }, off)).toBeNull()
    expect(routeForNotification({ kind: "freeze.declined" }, off)).toBeNull()
  })

  it("member.approved opens the Home tab", () => {
    expect(routeForNotification({ kind: "member.approved" }, on)).toEqual({
      name: "Main",
      params: { screen: "Home" },
    })
  })

  it("member.join_requested opens the invite screen on that club", () => {
    expect(
      routeForNotification(
        { kind: "member.join_requested", workspaceId: "ws-1" },
        on,
      ),
    ).toEqual({ name: "ClubInvite", params: { workspaceId: "ws-1" } })
    expect(
      routeForNotification({ kind: "member.join_requested" }, on),
    ).toEqual({ name: "ClubInvite" })
  })

  it("member.joined has no screen to open (staff read it in the inbox)", () => {
    expect(routeForNotification({ kind: "member.joined" }, on)).toBeNull()
  })

  it.each([
    [{ kind: "session.reminder" }],
    [{ kind: "exception.notify" }],
    [{ kind: "dropin.booked" }],
    [{ kind: "dropin.cancelled" }],
  ])(
    "%j -> the Schedule tab",
    (metadata) => {
      expect(routeForNotification(metadata, on)).toEqual({
        name: "Main",
        params: { screen: "Schedule" },
      })
    },
  )

  it.each([
    "personal.requested",
    "personal.proposed",
    "personal.confirmed",
    "personal.declined",
    "personal.cancelled",
  ])("%s opens the request, or the list without an id", (kind) => {
    expect(routeForNotification({ kind, requestId: "r1" }, on)).toEqual({
      name: "PersonalTraining",
      params: { requestId: "r1" },
    })
    expect(routeForNotification({ kind }, on)).toEqual({
      name: "PersonalTrainings",
    })
  })

  it("opens a video by id", () => {
    expect(
      routeForNotification({ kind: "video.published", videoId: "v1" }, on),
    ).toEqual({ name: "Video", params: { videoId: "v1" } })
    expect(
      routeForNotification({ kind: "video.ready", videoId: "v1" }, on),
    ).toEqual({ name: "Video", params: { videoId: "v1" } })
  })

  it("opens a course by id with its title", () => {
    expect(
      routeForNotification(
        { kind: "course.published", courseId: "c1", title: "Гард" },
        on,
      ),
    ).toEqual({ name: "CourseDetail", params: { courseId: "c1", title: "Гард" } })
  })

  it("opens no video or course while videos are off", () => {
    const noVideos = (key: string) => key !== "videos"
    expect(
      routeForNotification({ kind: "video.published", videoId: "v1" }, noVideos),
    ).toBeNull()
    expect(
      routeForNotification({ kind: "video.ready", videoId: "v1" }, noVideos),
    ).toBeNull()
    expect(
      routeForNotification({ kind: "course.published", courseId: "c1" }, noVideos),
    ).toBeNull()
    // The id-only fallback for older rows follows the flag too.
    expect(routeForNotification({ videoId: "v1" }, noVideos)).toBeNull()
  })

  it("has nothing to open for a video or course without its id", () => {
    expect(routeForNotification({ kind: "video.published" }, on)).toBeNull()
    expect(routeForNotification({ kind: "course.published" }, on)).toBeNull()
  })

  it("falls back to a bare videoId for rows without a known kind", () => {
    expect(routeForNotification({ videoId: "v9" }, on)).toEqual({
      name: "Video",
      params: { videoId: "v9" },
    })
  })

  it("still opens the Schedule tab (which holds My groups) when the schedule is off", () => {
    const scheduleOff = (key: string) => key !== "schedule"
    expect(
      routeForNotification({ kind: "session.reminder" }, scheduleOff),
    ).toEqual({ name: "Main", params: { screen: "Schedule" } })
  })

  it("returns null when the target section is switched off", () => {
    expect(routeForNotification({ kind: "rank.promoted" }, off)).toBeNull()
    expect(routeForNotification({ kind: "event.reminder" }, off)).toBeNull()
    expect(routeForNotification({ kind: "session.reminder" }, off)).toBeNull()
    expect(routeForNotification({ kind: "retention.digest" }, off)).toEqual({
      name: "AtRiskMembers",
    })
  })

  it("has no Schedule tab to open once schedule and groups are both off", () => {
    const neither = (key: string) => key !== "schedule" && key !== "groups"
    expect(
      routeForNotification({ kind: "session.reminder" }, neither),
    ).toBeNull()
  })

  it("never throws on unknown or malformed metadata", () => {
    expect(routeForNotification({ kind: "something.new" }, on)).toBeNull()
    expect(routeForNotification(null, on)).toBeNull()
    expect(routeForNotification(undefined, on)).toBeNull()
    expect(routeForNotification("junk", on)).toBeNull()
    expect(routeForNotification({ kind: 5, videoId: 7 }, on)).toBeNull()
  })
})

describe("openNotificationRoute", () => {
  it("returns to the existing tab bar when opening a tab", () => {
    const navigate = jest.fn()
    openNotificationRoute(
      { navigate },
      { name: "Main", params: { screen: "Schedule" } },
    )
    expect(navigate).toHaveBeenCalledWith(
      "Main",
      { screen: "Schedule" },
      { pop: true },
    )
  })

  it("pushes any other screen plainly", () => {
    const navigate = jest.fn()
    openNotificationRoute({ navigate }, { name: "Events" })
    expect(navigate).toHaveBeenCalledWith("Events", undefined, undefined)
  })
})
