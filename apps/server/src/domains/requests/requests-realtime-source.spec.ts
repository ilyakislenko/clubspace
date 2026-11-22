import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// «Заявки» stay live only if every write that opens or closes a request tells
// the workspace room 'requests' (docs/design/2026-11-15-requests-inbox.md §3.4).
// A new writer that forgets it leaves admin screens stale until a reload.
const SRC = join(__dirname, '..', '..')

const WRITERS = [
    // join
    'domains/workspace/services/join-request.service.ts',
    'features/add-workspace-member/add-workspace-member.handler.ts',
    'features/invite-workspace-member/invite-workspace-member.handler.ts',
    'features/reject-pending-member/reject-pending-member.handler.ts',
    // freeze
    'features/subscription-freeze-requests/request-subscription-freeze.handler.ts',
    'features/subscription-freeze-requests/approve-subscription-freeze-request.handler.ts',
    'features/subscription-freeze-requests/decline-subscription-freeze-request.handler.ts',
    'features/subscription-freeze-requests/cancel-subscription-freeze-request.handler.ts',
    'features/remove-workspace-member/remove-workspace-member.handler.ts',
    'features/my-memberships/leave-workspace.handler.ts',
    'features/member-subscriptions/cancel-subscription.handler.ts',
    'features/platform/reset-platform-demo-club.handler.ts',
    // personal training
    'features/personal-trainings/request-personal-training.handler.ts',
    'features/personal-trainings/accept-personal-training.handler.ts',
    'features/personal-trainings/propose-personal-training-time.handler.ts',
    'features/personal-trainings/decline-personal-training.handler.ts',
    'features/personal-trainings/cancel-personal-training.handler.ts',
    // video review
    'features/video-reviews/complete-my-video-review-upload.handler.ts',
    'features/video-reviews/set-video-review-status.handler.ts',
    'features/video-reviews/delete-my-video-review.handler.ts',
]

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        if (name === 'generated' || name === 'node_modules') return []
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

describe('requests realtime key', () => {
    it.each(WRITERS)('%s signals the workspace room «requests»', (file) => {
        const src = readFileSync(join(SRC, file), 'utf8')
        // Inline (`invalidate(ws, [..., 'requests'])`) or via a resource list.
        expect(src).toContain("'requests'")
        expect(src).toMatch(/realtime\.invalidate\(/)
    })

    it("every write that refreshes 'freeze-requests' refreshes 'requests' too", () => {
        const missing = walk(SRC)
            .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
            .filter((f) => {
                const src = readFileSync(f, 'utf8')
                return src.includes("'freeze-requests'") && !src.includes("'requests'")
            })
            .map((f) => relative(SRC, f))
        expect(missing).toEqual([])
    })
})
