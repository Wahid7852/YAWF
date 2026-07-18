# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 3.0.0

Full rewrite from C++/gtkmm/WebKitGTK to Electron. The old implementation
(`src/`, CMake, debian/snap/AppImage/Flatpak packaging configs) is removed
entirely, see `README.md` for the current feature set and `CONTRIBUTING.md`
for what's been tested against a real account so far.

### Added
* In-app phone number dialog (`Ctrl+Shift+P`), separate from the `whatsapp:`
  OS-level deep link
* Zoom controls (`Ctrl+=`/`Ctrl+-`/`Ctrl+0`, persisted) and fullscreen (`F11`)
* CLI remote control against an already-running instance
  (`yawf --show/--hide/--refresh/--quit`)
* Custom CSS support (`~/.config/yawf/user.css`)
* Built-in resource monitor (`Ctrl+Shift+R`), live CPU/RAM per process
* `.rpm` and `.pacman` packages, in addition to `.deb` and `.AppImage`
* UI translated into 16 languages, matching the OS locale automatically
  (the same set the old app shipped, minus none - see "Removed" in the
  previous draft of this entry, which undersold it as 18 and not-yet-ported)

### Changed
* Spellcheck now uses Chromium's built-in spellchecker instead of an optional
  libhunspell dependency
* Memory management: V8 heap capped at 40% of physical RAM (same ratio as the
  old WebKit memory-pressure tuning), idle heap reset carried over unchanged

### Fixed
* A `TypeError: Object has been destroyed` crashed the main process on every
  window close (reading `webContents.id` inside the `closed` handler, after
  Electron had already torn the window down)
* Packaged builds fatally crashed a few seconds into every session from a
  Vulkan/Wayland GPU-process incompatibility
* `build/icons/` was never bundled into packaged builds, so tray/window/dialog
  icons were silently broken outside the dev (`npm start`) environment

### Removed
* Snap, Flatpak, and Launchpad PPA distribution are unpublished until rebuilt
  for the new packaging pipeline

## 2.1.0

### Added
* **Auto-reload after 4 hours idle**: after four hours without a keypress or
  scroll, YAWF silently reloads WhatsApp Web to reclaim the JS heap that
  accumulates from high-volume group chats. Messages reload from local IndexedDB
  in seconds; no re-link or server re-fetch required. Any interaction resets the
  clock so active sessions are never interrupted.
* **Tray > Refresh**: new menu item in the system-tray context menu for
  on-demand reload when you notice slowdown, without waiting for the idle timer.

### Fixed
* WebKit memory pressure thresholds were set against an 8 GB base limit, meaning
  they never triggered on real hardware before the OS OOM-killed the web process
  at ~3 GB. Limit is now derived from `/proc/meminfo` (40% of physical RAM,
  clamped to 2–4 GB) so cache-release fires at ~2 GB on an 8 GB machine.
* Memory pressure is now polled every 5 s instead of every 30 s, so spikes from
  message storms are caught before they become fatal.
* Enabled JavaScriptCore concurrent GC (reduces main-thread stall during message
  storms) and generational GC (short-lived message objects collected cheaply).
* WebInspector bundle no longer loaded in normal use; set `YAWF_DEVTOOLS=1` to
  re-enable it for debugging.
* Unresponsive web-process detection tightened from 5 s to 3 s.

## 2.0.0

First release of **YAWF** (Yet Another WhatsApp Fork), forked from
[WasIstLos](https://github.com/xeco23/WasIstLos) and rebranded to
`io.github.wahid7852.YAWF`.

### Added
* Automatic recovery from WhatsApp Web's crash screen, with reload backoff.
* Paste images from the clipboard straight into the composer (`Ctrl+V` /
  `Ctrl+Shift+V`).
* Capture a screen region directly into a chat (`Ctrl+Shift+S`), auto-detecting
  the desktop's screenshot tool (Spectacle / gnome-screenshot / grim+slurp /
  maim / flameshot / ImageMagick).
* Telegram-style markdown shortcuts: bold (`Ctrl+B`), italic (`Ctrl+I`),
  strikethrough (`Ctrl+Shift+X`), monospace (`Ctrl+Shift+M`), clear formatting
  (`Ctrl+Shift+N`).
* Optional "send with `Ctrl+Enter`" composer mode (Preferences).
* One-time migration of existing `wasistlos` config/session/settings on first run.
* `whatsapp:` scheme links open/raise the app; group-invite links are copied to
  the clipboard with a notification (WhatsApp Web can't join them directly).
* Automatic recovery from WhatsApp's "A database error occurred" screen by clearing
  the corrupted local storage and reloading for a clean re-link.

### Changed
* Rebranded to YAWF; binary is now `yawf`.
* The linked device now identifies as Chrome on Linux instead of "Safari (Mac OS)",
  which also makes device linking reliable.
* No longer force-kills the web process under memory pressure, that was corrupting
  WhatsApp's local database and logging you out / breaking device linking.
* Disabled the DMABUF renderer to avoid a libEGL teardown crash on Intel/Mesa.
* Faster warm reloads via the web-browser cache model.
* Smoother UI: the crash-screen watcher no longer forces a layout reflow on a timer.
* GStreamer logging capped by default and the logger pipe made non-blocking so a
  log flood can't stall the renderer.

### Credits
* Original application by [xeco23 (Enes Hecan)](https://github.com/xeco23) and
  contributors.
