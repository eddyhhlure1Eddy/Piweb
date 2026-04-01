# Changelog

All notable changes to PIweb will be documented in this file.

---

## [2.1.0] - 2026-04-01

### New Features
- **PWA Support** — Full Progressive Web App, installable on iOS/Android home screen as standalone app
- **Favicon & App Icons** — SVG + ICO + PNG multi-format icons served from `/public`
- **Web App Manifest** — `manifest.json` with 192px/512px maskable icons, standalone display mode
- **Service Worker** — Precaches core assets, network-first strategy, offline fallback for static resources
- **iOS Standalone Mode** — `apple-mobile-web-app-capable`, translucent status bar, apple-touch-icon

### Bug Fixes
- **iOS Keyboard Push-Up Fix** — Virtual keyboard no longer pushes entire page upward
  - `body` set to `position: fixed` to prevent iOS elastic scroll
  - `visualViewport` resize + scroll events tracked with `requestAnimationFrame` throttle
  - `translateY(offsetTop)` compensates iOS viewport displacement in real-time
  - Chat auto-scrolls to bottom when keyboard opens
- **iOS Body Bounce Prevention** — `touchmove` intercepted on non-scrollable areas when keyboard is open
- **Favicon 204 Elimination** — `/favicon.ico` now returns actual icon file instead of empty 204 response

### Improvements
- **Static Asset Router** — `web.ts` serves 7 static paths (favicon, icons, manifest, sw.js) with proper MIME types and cache headers
- **Cache Strategy** — `sw.js` uses `no-cache` for instant updates; icons/manifest use `max-age=86400`
- **Three-Device Deployment** — Verified and deployed across Old Pi (.54), New Pi (.39), WalnutPi (.198)

### Technical Details
- `src/web.ts`: Replaced single favicon 204 handler with `staticFiles` map routing
- `public/index.html`: Added 7 meta/link tags in `<head>`, iOS viewport JS fix, SW registration
- `public/manifest.json`: PWA manifest with `display: standalone`, dark theme colors
- `public/sw.js`: Lightweight service worker, skips `/api/` and `/ws` paths
- Icon pipeline: Existing SVG/ICO from `icon/` folder, Pillow-generated 192px and 180px PNGs

### Files Changed
| File | Type | Change |
|------|------|--------|
| `src/web.ts` | Modified | Static asset serving with MIME + cache headers |
| `public/index.html` | Modified | PWA meta tags, iOS keyboard fix, SW registration |
| `public/favicon.ico` | New | Multi-size ICO icon |
| `public/icon.svg` | New | Vector icon |
| `public/icon-192.png` | New | PWA icon 192x192 |
| `public/icon-512.png` | New | PWA icon 512x512 |
| `public/apple-touch-icon.png` | New | iOS home screen icon 180x180 |
| `public/manifest.json` | New | PWA web app manifest |
| `public/sw.js` | New | Service worker |
| `package.json` | Modified | Version bump 2.0.0 -> 2.1.0 |
| `README.md` | Modified | Version badge + release status update |

---

## [2.0.5] - 2026-03-08

### Changes
- Config switch: FunnyPi -> Local LLM server
- Removed proxy environment variables from `piweb.service` (fix `fetch failed` with local backend)
- Restored Pi Service button in `index.html` from backup
- Removed all Claude -> GLM-5 automatic fallback logic from `agent.ts` and `scheduler.ts`

---

## [2.0.4] - 2026-03-06

### Changes
- Model Scheduler (`scheduler.ts`) — routes init/work/reflect/compress to different models
- FunnyPi provider integration with Plan A/B selection
- Fixed: init phase always using work model, `<think>` tag leak, assistant array content, abort handling

---

## [2.0.3] - 2026-03-01

### Changes
- WiFi relay daemon architecture
- Tool digest reconstruction
- `__FILE:/__IMG:` base64 leak stripping
- Thinking model compression (60s timeout, 5x tokens)
- Interleaved thinking / reflection system
- Progressive tool blocking (3 failures = removed)
- MCP hot-add/remove, resource listing
- Degraded mode (model unreachable, web UI stays up)

---

## [2.0.2] - 2026-02-28

### Changes
- Atomic write, mutex for memory persistence
- Session ID collision fix, race condition fix
- Role alternation enforcement

---

## [2.0.1] - 2026-02-22

### Changes
- `edit_file` tool, `read_file` pagination
- `memory_read` returns ID
- Screenshot Linux compatibility
