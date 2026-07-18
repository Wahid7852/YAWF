# YAWF

**Y**et **A**nother **W**hatsApp **F**ork, an unofficial WhatsApp desktop client for
Linux, built on Electron. Originally a C++/gtkmm/WebKitGTK app (a fork of
[xeco23/WasIstLos](https://github.com/xeco23/WasIstLos)), rewritten from scratch
starting at version 3.0.0.

[![Action Status](https://github.com/Wahid7852/YAWF/workflows/Build/badge.svg)](https://github.com/Wahid7852/YAWF/actions/workflows/build.yml)
[![Action Status](https://github.com/Wahid7852/YAWF/workflows/Release/badge.svg)](https://github.com/Wahid7852/YAWF/actions/workflows/release.yml)

## About

YAWF wraps WhatsApp Web in a dedicated window and adds the desktop integration
and reliability work a browser tab doesn't do for you: it recovers on its own
when WhatsApp Web crashes or hangs, keeps memory in check over long sessions,
and adds the productivity features power users actually ask for, clipboard
image paste, screenshot straight into a chat, markdown formatting shortcuts,
multiple accounts at once.

## Features

**Desktop integration**
- Tray icon with unread count, system notifications, autostart
- Multiple accounts via `--profile <name>`, isolated session per profile
- Zoom, fullscreen, spellcheck (native Chromium)
- Open a chat directly by phone number, in-app dialog or `whatsapp:` deep link
- CLI remote control: `yawf --show / --hide / --refresh / --quit`
- Custom CSS at `~/.config/yawf/user.css`

**Reliability**
- Auto-recovery: reloads itself on renderer crashes and on WhatsApp Web's own
  in-page "something went wrong" screen, with backoff so it never loops
- Idle heap reset: reloads after 4h of no input to reclaim JS heap (configurable)
- V8 memory capped at 40% of physical RAM instead of left unbounded
- Built-in resource monitor (`Ctrl+Shift+R`): live CPU/RAM per process, no
  guessing what the app is actually costing you

**Power-user shortcuts**

| Shortcut | Action |
|---|---|
| `Ctrl+B` / `Ctrl+I` | Wrap selection in `*bold*` / `_italic_` |
| `Ctrl+Shift+X` / `Ctrl+Shift+M` | Wrap in `~strikethrough~` / ` ```monospace``` ` |
| `Ctrl+Shift+N` | Clear formatting from selection |
| `Ctrl+Shift+V` | Force an image-only paste from the clipboard |
| `Ctrl+Shift+S` | Capture a screen region straight into the chat |
| `Ctrl+Shift+P` | Open a chat by phone number |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `F11` | Toggle fullscreen |
| `Ctrl+/` | Shortcut list, in-app |

`Ctrl+Enter` to send instead of plain `Enter` is opt-in via Preferences.

## Install

Grab a `.deb`, `.AppImage`, `.rpm`, or `.pacman` from the
[Releases](https://github.com/Wahid7852/YAWF/releases) page, or:

- **Arch (AUR)**: `yay -S yawf-bin`, packaging in [`packaging/aur`](packaging/aur)
- **Snap**, **Flatpak**: not published yet

## Development

```
npm install
npm start
```

`npm run dist:linux` builds `.deb`/`.AppImage`/`.rpm`/`.pacman` via
electron-builder (`electron-builder.yml`). Snap isn't in that list, it needs
the same CI-only `snapcore/action-build` wrapper as everything else does for
snap, plain electron-builder doesn't build it reliably here.

## Why this is different

Most "WhatsApp wrapper" projects, [elecwhat](https://github.com/piec/elecwhat)
included, are a webview and a tray icon. This one treats the browser tab as
the thing that fails, not the app around it. WhatsApp Web crashes, hangs, and
leaks memory on its own, regardless of what shell it runs in. Crash
auto-recovery, idle heap reset, forced image paste, screenshot-to-chat,
multi-profile sessions all exist because the wrapper has to outlive the page
it wraps, not because a browser tab was missing a couple of shortcuts.

The resource monitor is the clearest example of the difference in approach.
Nobody ships a window that tells you what your own app is costing you in CPU
and RAM, most Electron apps would rather you didn't look too closely. This one
hands you the numbers, unprompted, updated every two seconds. Running
Chromium instead of the old WebKitGTK build costs more memory, that's just
true, so you get to see exactly how much instead of taking it on faith.

Same instinct on security. The window that loads WhatsApp Web has no
`contextBridge` exposure into the page and no `nodeIntegration`, so it has no
way to reach the app's internals even in principle. Every IPC handler on top
of that checks its sender is a window this app actually created. That's the
difference between "should be fine" and "checked."

And it's exercised against a real account before it ships, not just read
over. The first packaged build had a fatal GPU crash and silently broken tray
icons, both caught by actually running the thing and watching it fail.

## Known gaps

- Tray icon doesn't register a StatusNotifierItem on some Wayland setups
  (confirmed environment-level, not unique to this app), window hide/show
  and notifications work regardless
- `.rpm` build is untested locally (no `rpmbuild` available in dev), uses the
  same pipeline as the verified `.deb`/`.pacman` builds
- Locale support (the old app had 18) hasn't been ported yet
- Flatpak and Launchpad PPA distribution are manual/unpublished for now

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the fuller list of what's been
verified and how.

## License

GPL-3.0, see [`LICENSE`](LICENSE).
