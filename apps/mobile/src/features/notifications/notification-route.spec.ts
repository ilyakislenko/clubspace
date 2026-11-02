import type { WorkspaceSummary } from "../../shared/api/workspaces"
import {
  clubToSwitchTo,
  isInvitationNotification,
  openNotification,
  openNotificationRoute,
  profileForNotification,
  resolveNotification,
  routeForNotification,
} from "./notification-route"

const on = () => true
const off = () => false

describe("routeForNotification", () => {
  it.each([
    [{ kind: "rank.promoted" }, "MyRanks"],
    [{ kind: "grading.candidate" }, "MyRanks"],
    [{ kind: "grading.moved" }, "MyRanks"],
    [{ kind: "grading.cancelled" }, "MyRanks"],
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
    [{ kind: "payment.succeeded", eventRegistrationId: "reg-1" }, "Events"],
    [{ kind: "retention.digest" }, "AtRiskMembers"],
    [{ kind: "classbooking.promoted" }, "MyClassBookings"],
    [{ kind: "classbooking.added" }, "MyClassBookings"],
    [{ kind: "classbooking.club_cancelled" }, "MyClassBookings"],
    [{ kind: "classbooking.noshow" }, "MyClassBookings"],
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

  it("member.invitation opens the Invitations screen", () => {
    expect(
      routeForNotification(
        { kind: "member.invitation", workspaceId: "ws-9", invitationId: "i1" },
        off,
      ),
    ).toEqual({ name: "Invitations" })
  })

  it.each([
    [{ kind: "session.reminder" }],
    [{ kind: "exception.notify" }],
    [{ kind: "schedule.moved" }],
    [{ kind: "dropin.booked" }],
    [{ kind: "dropin.cancelled" }],
    [{ kind: "substitution.approved" }],
    [{ kind: "substitution.requested" }],
    [{ kind: "substitution.members" }],
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

describe("clubToSwitchTo / openNotification", () => {
  const club = (workspaceId: string, features?: object, accessExpired = false) =>
    ({ workspaceId, features, accessExpired }) as unknown as WorkspaceSummary
  const a = club("a")
  const b = club("b")
  // Signed in as the guardian, no children.
  const asGuardian = {
    actingAsId: null,
    switchableIds: [],
    switchProfileThenOpen: () => undefined,
  }

  it("picks the other club the notification names", () => {
    expect(clubToSwitchTo({ workspaceId: "b" }, a, [a, b])).toBe(b)
  })

  it("does nothing for the active club, a missing id or a club not in the list", () => {
    expect(clubToSwitchTo({ workspaceId: "a" }, a, [a, b])).toBeNull()
    expect(clubToSwitchTo({ kind: "x" }, a, [a, b])).toBeNull()
    expect(clubToSwitchTo(null, a, [a, b])).toBeNull()
    expect(clubToSwitchTo({ workspaceId: "z" }, a, [a, b])).toBeNull()
  })

  it("switches first, then navigates, judging flags against the target club", () => {
    const calls: string[] = []
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    const bNoRanks = club("b", { ranks: false })
    const switchWorkspace = (id: string) => calls.push(`switch:${id}`)
    expect(
      openNotification(nav, { kind: "freeze.approved", workspaceId: "b" }, {
        ...asGuardian,
        workspace: a,
        workspaces: [a, bNoRanks],
        switchWorkspace,
      }),
    ).toBe(true)
    expect(calls).toEqual(["switch:b", "nav:MySubscription"])

    calls.length = 0
    expect(
      openNotification(nav, { kind: "grading.candidate", workspaceId: "b" }, {
        ...asGuardian,
        workspace: a,
        workspaces: [a, bNoRanks],
        switchWorkspace,
      }),
    ).toBe(false)
    expect(calls).toEqual([])
  })

  it("never switches into a club whose access has lapsed, nor into one not in the list", () => {
    const lapsed = club("c", undefined, true)
    expect(clubToSwitchTo({ workspaceId: "c" }, a, [a, lapsed])).toBeNull()
    const calls: string[] = []
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    const switchWorkspace = (id: string) => calls.push(`switch:${id}`)
    for (const [meta, list] of [
      [{ kind: "freeze.approved", workspaceId: "c" }, [a, lapsed]],
      [{ kind: "freeze.approved", workspaceId: "z" }, [a, b]],
    ] as const) {
      expect(
        openNotification(nav, meta, {
          ...asGuardian,
          workspace: a,
          workspaces: [...list],
          switchWorkspace,
        }),
      ).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it("opens an invitation from a club the member is not in, without switching", () => {
    const calls: string[] = []
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    const switchWorkspace = (id: string) => calls.push(`switch:${id}`)
    const meta = { kind: "member.invitation", workspaceId: "z", invitationId: "i1" }
    expect(
      openNotification(nav, meta, {
        ...asGuardian,
        workspace: a,
        workspaces: [a, b],
        switchWorkspace,
      }),
    ).toBe(true)
    expect(calls).toEqual(["nav:Invitations"])
  })

  it("opens an invitation for a member with no club at all", () => {
    const calls: string[] = []
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    expect(
      openNotification(
        nav,
        { kind: "member.invitation", workspaceId: "z" },
        {
          ...asGuardian,
          workspace: null,
          workspaces: [],
          switchWorkspace: () => calls.push("switch"),
        },
      ),
    ).toBe(true)
    expect(calls).toEqual(["nav:Invitations"])
  })

  it("never switches for an invitation even if the club is in the list", () => {
    expect(
      resolveNotification(
        { kind: "member.invitation", workspaceId: "b" },
        { ...asGuardian, workspace: a, workspaces: [a, b] },
      ),
    ).toEqual({ kind: "open", route: { name: "Invitations" }, target: null })
  })

  it("switches back to the guardian for an invitation tapped in a child's profile", () => {
    const calls: string[] = []
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    expect(
      openNotification(nav, { kind: "member.invitation", workspaceId: "z" }, {
        actingAsId: "kid-1",
        switchableIds: ["kid-1"],
        workspace: a,
        workspaces: [a],
        switchWorkspace: () => calls.push("switch"),
        switchProfileThenOpen: (id) => calls.push(`profile:${id}`),
      }),
    ).toBe(true)
    expect(calls).toEqual(["profile:null"])
  })

  it("tells an invitation apart from other kinds", () => {
    expect(isInvitationNotification({ kind: "member.invitation" })).toBe(true)
    expect(isInvitationNotification({ kind: "member.approved" })).toBe(false)
    expect(isInvitationNotification(null)).toBe(false)
  })
})

describe("notifications for a child (metadata.dependentId)", () => {
  const club = (workspaceId: string) =>
    ({ workspaceId, accessExpired: false }) as unknown as WorkspaceSummary
  const guardianClub = club("g")
  const kidClub = club("k")

  const setup = (actingAsId: string | null, switchableIds: string[]) => {
    const calls: string[] = []
    const ctx = {
      actingAsId,
      switchableIds,
      workspace: actingAsId ? kidClub : guardianClub,
      workspaces: [actingAsId ? kidClub : guardianClub],
      switchWorkspace: (id: string) => calls.push(`club:${id}`),
      switchProfileThenOpen: (id: string | null, meta: unknown) =>
        calls.push(`profile:${id}:${(meta as { kind: string }).kind}`),
    }
    const nav = { navigate: (name: string) => calls.push(`nav:${name}`) }
    return { calls, ctx, nav }
  }

  it("switches to that child first instead of opening as the guardian", () => {
    const { calls, ctx, nav } = setup(null, ["kid-1"])
    const meta = { kind: "classes.low", dependentId: "kid-1", workspaceId: "k" }
    expect(resolveNotification(meta, ctx)).toEqual({
      kind: "switch-profile",
      dependentId: "kid-1",
    })
    expect(openNotification(nav, meta, ctx)).toBe(true)
    expect(calls).toEqual(["profile:kid-1:classes.low"])
  })

  it("opens it straight away once that child is the active profile", () => {
    const { calls, ctx, nav } = setup("kid-1", ["kid-1"])
    const meta = { kind: "classes.low", dependentId: "kid-1", workspaceId: "k" }
    expect(openNotification(nav, meta, ctx)).toBe(true)
    expect(calls).toEqual(["nav:MySubscription"])
  })

  it("moves from one child to another", () => {
    const { calls, ctx, nav } = setup("kid-1", ["kid-1", "kid-2"])
    openNotification(nav, { kind: "rank.promoted", dependentId: "kid-2" }, ctx)
    expect(calls).toEqual(["profile:kid-2:rank.promoted"])
  })

  it("has nothing to open for a child the guardian can't act for", () => {
    const { calls, ctx, nav } = setup(null, ["kid-1"])
    const meta = { kind: "classes.low", dependentId: "kid-9" }
    expect(resolveNotification(meta, ctx)).toBeNull()
    expect(openNotification(nav, meta, ctx)).toBe(false)
    expect(calls).toEqual([])
  })

  it("switches back to the guardian for the guardian's own notification", () => {
    const { calls, ctx, nav } = setup("kid-1", ["kid-1"])
    openNotification(nav, { kind: "announcement.published" }, ctx)
    expect(calls).toEqual(["profile:null:announcement.published"])
  })

  it("stays put for a notification with nothing to open in any profile", () => {
    const { calls, ctx, nav } = setup("kid-1", ["kid-1"])
    expect(openNotification(nav, { kind: "member.joined" }, ctx)).toBe(false)
    expect(calls).toEqual([])
  })

  it("opens a club's child invitation on «Дети» as the guardian", () => {
    expect(
      routeForNotification({ kind: "guardian.invite", dependentId: "kid-3" }, on),
    ).toEqual({ name: "Children" })
    const meta = {
      kind: "guardian.invite",
      dependentId: "kid-3",
      invitedByWorkspaceId: "k",
    }

    const asGuardian = setup(null, ["kid-1"])
    expect(openNotification(asGuardian.nav, meta, asGuardian.ctx)).toBe(true)
    expect(asGuardian.calls).toEqual(["nav:Children"])

    const asChild = setup("kid-1", ["kid-1"])
    expect(openNotification(asChild.nav, meta, asChild.ctx)).toBe(true)
    expect(asChild.calls).toEqual(["profile:null:guardian.invite"])
  })
})

describe("profileForNotification", () => {
  it("names the profile a notification belongs to", () => {
    const ctx = { actingAsId: null, switchableIds: ["kid-1"] }
    expect(profileForNotification({ kind: "x" }, ctx)).toEqual({ kind: "stay" })
    expect(
      profileForNotification({ kind: "x", dependentId: "kid-1" }, ctx),
    ).toEqual({ kind: "switch", dependentId: "kid-1" })
    expect(
      profileForNotification({ kind: "x", dependentId: "kid-2" }, ctx),
    ).toEqual({ kind: "unavailable" })
    expect(profileForNotification(null, ctx)).toEqual({ kind: "stay" })
  })
})
