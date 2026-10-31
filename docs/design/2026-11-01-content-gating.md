# Content gating: course audience and locked progression

## What a club can configure

In the course editor («Доступ к курсу»), coaching staff choose who can watch a course:

| Restriction | Rule | What a student outside it sees |
|---|---|---|
| Groups | member of **any** selected group | **nothing**: the course is not listed, its page is 404, and its videos are 404 |
| Minimum level | on **any** ladder, current level `order` ≥ the selected level's `order` (current = latest `RankPromotion` on that ladder) | a **teaser**: listed with a lock, «Доступно с уровня «Синий пояс»». The lesson list is visible, but playback is refused. |
| Plans | a usable abonement (`isSubscriptionUsable`) on **any** selected plan | a **teaser**: «Доступно по абонементу «Безлимит»» |

Within one restriction kind the options are OR-ed. Different kinds are AND-ed. When no restrictions are set, the course is open to the whole club. Staff (owner, admin, head coach, coach, super admin) always see and play everything. The list and detail views show them `audienceSummary`.

### Why teaser vs hidden

- **Group**: a private curriculum (kids, a competition team). Showing it to everyone else only creates noise, and asking for access doesn't help. It is hidden, and «Новый курс» / «Новое видео» pushes go only to that group and staff.
- **Rank and plan**: they motivate students. A white belt sees what blue belt unlocks, and a student sees what a better abonement includes. These courses appear with the reason in Russian, and the lessons are listed but locked.

### Deleted targets fail closed

`CourseAudience.kind` is stored next to a nullable target (`groupId` / `rankLevelId` / `planId`, all `onDelete: SetNull`). If a group, level or plan is deleted, its row stays behind and matches nobody. The course then stays closed for that condition instead of silently opening to the whole club. The editor shows a warning, and saving the audience again drops those rows.

## Locked progression

When `Course.lockedProgression` is set, lessons open in course order (`CourseVideo.order`, then `videoId`). A lesson is locked until the nearest previous required (non-optional) lesson is `VideoWatched.completed`. The first lesson is always open. The lock reason is «Сначала посмотрите предыдущий урок».

`completed` is set by `save-video-progress` when the position reaches 90% of the duration. In a locked-progression course, a student's explicit "mark watched" below 90% is ignored, so the button can't be used to skip ahead. The mobile app hides the button in such courses.

## One gate for every video route

`CourseAccessService.assertCanWatchVideo` is used by:

- playback (`/videos/:id/playback`)
- the HLS manifest proxy, which re-checks on every playlist fetch
- offline download and offline manifest
- the member video detail (`/workspaces/:id/videos/:videoId`)
- progress writes

It applies the same visibility rule as the course list (`publishedAt <= now`), plus the audience and progression rules:

- **Student, the video is in no published course they can see:** 404.
- **The course is visible but locked:** 403 with the reason.
- **Staff:** always allowed.

Offline links (the MP4 download and the offline manifest segment URLs) are presigned for 30 minutes instead of 6 hours.

## API

- `GET/PUT /workspaces/:workspaceId/playlists/:playlistId/audience`. Coaching staff only. The response includes all of the club's groups, ladders and plans, so a coach can use the picker without the admin-only list endpoints.
- `lock` (`{ kind: GROUP|RANK|PLAN|PROGRESSION, reason }` or null) on each course in the list and detail, and on each lesson. `audienceSummary` is filled for staff only.
- `Course.accessLevel` was removed; it was never enforced. `level` stays as a free-text difficulty label for display.
