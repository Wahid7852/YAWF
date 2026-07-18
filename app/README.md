# YAWF (Electron)

Electron rewrite of YAWF, living alongside the original C++/gtkmm/WebKitGTK app in
`../src`. Nothing in the old app or its packaging is touched by this, see
`../CHANGELOG.md` for that app's history. This directory is self-contained: its own
`package.json`, no shared build steps.

## Run

```
npm install
npm start
```

`npm run dist:linux` builds `.deb`/`.AppImage`/`.snap`/`.rpm`/`.pacman` via
electron-builder (see `electron-builder.yml`). `.deb`/`.AppImage`/`.pacman` are
locally verified (built, then `dpkg-deb --info` / installed the AppImage /
`pacman -U`-tested); `.rpm` uses the same fpm pipeline as those but wasn't
locally testable (no `rpmbuild` on this machine); `.snap` needs the same
`snapcore/action-build`-style CI wrapper the C++ app uses, not plain
electron-builder - see `.github/workflows/release.yml`'s `release-electron`
job, which deliberately excludes snap for that reason.

Installed system-wide via the pacman package (`yawf`, built from
`electron-builder.yml`'s pacman target) - `/opt/YAWF`, `/usr/bin/yawf`,
proper `.desktop`/icon entries, shows up as "YAWF" in the app launcher. AUR
package at `../packaging/aur-electron/` (`yawf-electron-bin`, repackages the
release AppImage) is the same thing for anyone installing from AUR instead of
a local build - separate from `../packaging/aur/` (the C++ app's PKGBUILD),
not a replacement for it.

## CLI

- `--profile <name>` - isolated session (own `userData` dir), for multi-account use
- `--show` / `--hide` / `--refresh` / `--quit` - remote-control an already-running
  instance (delivered over the single-instance lock, so no D-Bus dependency)
- `whatsapp:<phone>` / `whatsapp://send?phone=<phone>` - deep link, opens that chat

## Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+B / Ctrl+I | `*bold*` / `_italic_` |
| Ctrl+Shift+X / Ctrl+Shift+M | `~strike~` / ` ```mono``` ` |
| Ctrl+Shift+N | clear formatting from selection |
| Ctrl+Shift+V | force an image-only paste from the clipboard |
| Ctrl+Shift+S | region screenshot straight into the composer |
| Ctrl+Shift+P | open a chat by phone number (dialog, not just the OS deep link) |
| Ctrl+=/-/0 | zoom in / out / reset (persisted) |
| F11 | toggle fullscreen |
| Ctrl+/ | this shortcut list, in-app |

Ctrl+Enter-to-send is opt-in via Preferences (tray menu). Tray menu also has
direct entries for the phone dialog and shortcuts list.

## Calls / video ("beta")

elecwhat's README notes calls need "WhatsApp Web Beta." That's a toggle inside
WhatsApp Web's own Settings, not something a wrapper app implements - loading
the unmodified page means it's already there. What the app *does* need to get
right is camera/mic permission grants, which `setPermissionRequestHandler` in
`main.js` covers (`notifications`, `media`, `clipboard-sanitized-write`).
Not yet tested against a real call end-to-end.

## Performance

Electron's baseline footprint (bundled Chromium + Node, multiple
zygote/GPU/utility processes) is heavier than the old app's WebKitGTK, which
shared system libraries and only ran one process - that gap is structural and
no amount of flag-tuning erases it. What's actually done about it:
- V8 old-space capped at 40% of physical RAM (`js-flags`/`--max-old-space-size`
  in `main.js`), same ratio as the old WebKit memory-pressure tuning
- `backgroundThrottling: true` so Chromium throttles timers/rAF while the
  window's hidden in the tray - real-time delivery still comes over the
  WebSocket, unaffected
- Trimmed background Chromium services this single-site wrapper never touches:
  background networking, sync, default-apps, component-update, domain-reliability,
  breakpad crash reporting
- Idle heap reset (default 4h) on top of that

Measured on this machine (16GB RAM) via the built-in resource monitor
(Ctrl+Shift+R): ~1.3GB / ~6 processes across a logged-in session with the
resource monitor window itself also open. Not benchmarked head-to-head
against the C++ app's actual RSS - that's real profiling work, not done, and
Electron will lose that comparison regardless of tuning.

**Found and fixed a real stability bug while testing this**: the packaged
AppImage was fatally crashing a few seconds into every session
(`FATAL:...GPU process isn't usable. Goodbye.`) after repeated GPU-process
launch failures tied to a Vulkan/Wayland incompatibility Chromium itself
warns about. Fixed by disabling the Vulkan feature path specifically (GL
acceleration stays on) - see the `disable-features` switch in `main.js`.
Confirmed stable across multiple 30-60s+ runs after the fix, zero recurrences.

**Also found**: `build/icons/` was never actually bundled into the packaged
app (missing from electron-builder's `files` list) - the tray icon, window
icon, and dialog icons were silently broken in every packaged build even
though the unpackaged `npm start` dev flow looked fine. Fixed, and `tray.js`
now fails loudly instead of silently if an icon is ever missing again.

## Resource monitor

Ctrl+Shift+R or tray → "Resource monitor…" opens a live table of every
Chromium subprocess (browser/renderer/GPU/utility/zygote) with per-process
CPU% and RAM, refreshed every 2s via `app.getAppMetrics()`. The tray tooltip
also carries a running total (`YAWF - N unread - XMB, Y% CPU`) without needing
the window open. elecwhat has nothing like this - closest thing there is
watching it in `htop`.

## User CSS

Drop a stylesheet at `~/.config/yawf/user.css` - it's injected on every load.

## Security

The one window that loads remote/untrusted content (WhatsApp Web itself, in
`mainWindow`) has no `contextBridge` exposure and no `nodeIntegration` - it
structurally cannot call `ipcRenderer` at all, regardless of anything WhatsApp's
own JS does. Every `ipcMain` handler is additionally gated behind a
`trustedWebContentsIds` check (`handleTrusted`/`onTrusted` in `main.js`) that
only admits windows this app created and loaded from its own local files -
defense in depth against a future mistake (someone later adding a bridge to
the main window, a dialog window navigating somewhere unexpected), not a fix
for a currently-reachable hole. Also reviewed: `setWindowOpenHandler` denies
everything except `http(s)` (via `shell.openExternal`, not in-app navigation),
`setPermissionRequestHandler` allow-lists exactly `notifications`/`media`/
`clipboard-sanitized-write` and denies everything else by default, deep-link
phone numbers are stripped to `[\d+]` before use, `--profile` names are
regex-validated against path traversal, zoom is clamped to 0.5-3, and every
`child_process.spawn` call in `screenshot.js` uses an argv array (never shell
string interpolation).

## Verified working (2026-07-18, on this machine - real WhatsApp session, not synthetic)

QR login, session persistence across restart, chat list + message rendering,
tray menu, `--quit`/`--show`/`--hide`/`--refresh` remote commands, no default
Electron menu bar, `.deb`/`.AppImage`/`.pacman` all built and inspected
(`dpkg-deb --info`, `pacman -Qi` after install), zoom persisting across
restart (confirmed via `settings.json`), phone dialog and shortcuts window
actually opening (confirmed via CDP: dispatched real `Ctrl+Shift+P`/`Ctrl+/`
keyboard events through the real preload pipeline, then verified the new
windows existed as separate CDP targets with the right content), resource
monitor populating live data (queried its DOM directly via CDP: 6 processes,
real CPU/RAM numbers), `--profile` isolation with two simultaneous instances
running at once against separate session directories, notification permission
grant (triggered a real `Notification` via CDP, confirmed `permission:
'granted'` rather than erroring), no IPC rejections logged after the
sender-verification hardening (confirmed the trusted windows can still call
their handlers). Tray icon/DBus StatusNotifierItem registration: confirmed
*not* appearing on this system's session bus for either this app or the
reference elecwhat install running alongside it all session - a systemic
Electron-tray-on-this-Wayland-setup quirk, not something unique to this code;
not chased further since it's not fixable from here. Window hide/show and
notifications-via-dunst work regardless of whether the tray icon itself
renders.

Not yet exercised: F11 fullscreen (same simple IPC path as zoom/phone-dialog/
shortcuts, which are all verified, so high confidence - just not visually
confirmed), screenshot-to-chat with a real region selection, idle-reload
firing after a real 4h+ idle period, a real WhatsApp call end-to-end (needs a
second account to call), `.rpm` build (no `rpmbuild` on this machine), `.snap`
build (needs the CI-only `snapcore/action-build` wrapper). The
`release-electron` GitHub Actions job itself has never actually run - written
and reasoned through, but only a push to the `release` branch will prove it.

## why this is different

Most "WhatsApp wrapper" projects, elecwhat included, are a webview and a tray
icon. This one treats the browser tab as the thing that fails, not the app
around it. WhatsApp Web crashes, hangs, and leaks memory on its own,
regardless of what shell it's running in. Crash auto-recovery, idle heap
reset, forced image paste, screenshot-to-chat, multi-profile sessions all
exist because the wrapper has to outlive the page it's wrapping, not because
a browser tab was missing a couple of shortcuts.

The resource monitor is the clearest example. Nobody ships a window that
tells you what your own app is costing you in CPU and RAM, most Electron
apps would rather you didn't look too closely. This one hands you the
numbers, unprompted, updated every two seconds. Running Chromium instead of
WebKitGTK costs more memory, that's just true, so you get to see exactly how
much instead of taking it on faith.

Same instinct on security. No `contextBridge` exposure into the WhatsApp Web
page itself, and every IPC handler checks that its sender is a window this
app actually created, not just any process that happens to share it. That's
the difference between "should be fine" and "checked."

And it's tested against a real account, not a demo. The packaged build had a
fatal GPU crash and silently broken tray/window icons before either got
caught, both by actually running the thing and watching it fail, not by
reading the code and assuming it worked.

## vs elecwhat

elecwhat (github.com/piec/elecwhat) is the closest existing project - ~800 LOC,
electron-builder, active (25+ releases). It has two things this didn't originally:
D-Bus/CLI remote control and user CSS support. Both are now covered above (CLI
instead of D-Bus - same scripting use case, smaller surface). Everything else this
app does that elecwhat doesn't - crash auto-recovery (renderer-crash *and*
in-page "something went wrong" screen detection), idle heap reset, multi-profile
accounts, forced image paste, screenshot-to-chat with 6-tool auto-detection,
markdown shortcuts - is a straight port of the existing C++ YAWF's feature set,
which already went further than elecwhat before this rewrite started.

## Deferred (not in this pass)

- Porting the 18 `../po/*.po` locales - separate task
- Flatpak manifest, Launchpad PPA automation - manual for now, matches the C++
  app's current status
- Custom notification sound override - intentionally skipped; Electron's native
  `Notification` already goes through the OS notification daemon, which already
  respects system sound preferences, so an app-level override would just fight it
