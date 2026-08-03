// Serves the built PWA (`dist-web/`) the way a real host must: SPA fallback to
// index.html, `no-cache` on the shell and the service worker, `immutable` on the
// hashed bundles. Verification only — the production deploy is your static host.
//
//   node scripts/serve-pwa.mjs [port]      # default 4201 (a CORS-allowed origin)
//
// Serving the folder with something that sends no cache headers (e.g.
// `python3 -m http.server`) makes the browser hold on to index.html, so after a
// rebuild you get a blank page pointing at a deleted bundle. That failure looks
// like an app bug and isn't one — hence this script.
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-web")
const port = Number(process.argv[2] ?? 4201)

if (!existsSync(join(root, "index.html"))) {
  console.error("[serve-pwa] dist-web/ is missing — run `npm run build:pwa` first.")
  process.exit(1)
}

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)
  // normalize() collapses any `..` before it can climb out of dist-web.
  const candidate = join(root, normalize(path))
  const isFile = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
  const file = isFile ? candidate : join(root, "index.html")

  const ext = extname(file)
  res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream")
  res.setHeader(
    "Cache-Control",
    file.includes(`${join("_expo", "static")}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  )
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`[serve-pwa] http://localhost:${port} → dist-web/`)
})
