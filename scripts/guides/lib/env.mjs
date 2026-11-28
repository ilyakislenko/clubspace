// Configuration of a recording run: where the stack is, who signs in, where
// files go. Everything is an environment variable with a local default
// (docs/guides.md, «Стенд»).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const url = (name, fallback) => (process.env[name]?.trim() || fallback).replace(/\/+$/, '')

// DEMO_LOGIN_CODE from the environment, else the repo .env — read into memory
// only: it is typed into the sign-in form and never printed or recorded.
function demoLoginCode() {
    const fromEnv = process.env.DEMO_LOGIN_CODE?.trim()
    if (fromEnv) return fromEnv
    const dotenv = join(REPO, '.env')
    if (!existsSync(dotenv)) return ''
    const line = readFileSync(dotenv, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('DEMO_LOGIN_CODE='))
    return line?.slice('DEMO_LOGIN_CODE='.length).trim().replace(/^["']|["']$/g, '') ?? ''
}

const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')

export const config = {
    adminUrl: url('GUIDES_ADMIN_URL', 'http://localhost:4301'),
    pwaUrl: url('GUIDES_PWA_URL', 'http://localhost:8086'),
    siteUrl: url('GUIDES_SITE_URL', 'http://localhost:4302'),
    apiUrl: url('GUIDES_API_URL', 'http://localhost:3301'),
    // Printed on the end card: where viewers find the other guides (the
    // public site, not the PWA at app.).
    publicHelpUrl: url('GUIDES_PUBLIC_HELP_URL', 'https://site.clubspace.space/help'),
    accounts: {
        owner: process.env.GUIDES_OWNER_EMAIL || 'owner@academy.demo',
        coach: process.env.GUIDES_COACH_EMAIL || 'coach@academy.demo',
        student: process.env.GUIDES_STUDENT_EMAIL || 'student@academy.demo',
        federation: process.env.GUIDES_FEDERATION_EMAIL || 'federation@academy.demo',
    },
    demoLoginCode: demoLoginCode(),
    workDir: process.env.GUIDES_WORK_DIR || '/tmp/guides/work',
    outDir: process.env.GUIDES_OUT_DIR || '/tmp/guides/out',
    // Suffix of the published file names: a CDN caches mp4/jpg by name, so
    // every re-recording gets new names (owner-setup-20261128.mp4).
    version: process.env.GUIDES_VERSION || today,
    ffmpeg: process.env.FFMPEG_PATH || (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'),
    ffprobe: process.env.FFPROBE_PATH || (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe'),
    headed: process.env.GUIDES_HEADED === '1',
}
