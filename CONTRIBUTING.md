# How to contribute

We are really happy you're reading this, because we need volunteers to help this project.

## Code

You can contribute by opening issues, resolving any issue especially [good first issues](https://github.com/Wahid7852/YAWF/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22),
improving documentation, adding [translations](https://github.com/Wahid7852/YAWF/wiki#translations) in your language etc.

### Submitting changes

Please send a [GitHub Pull Request to YAWF](https://github.com/Wahid7852/YAWF/pull/new/master) with a clear list of what you've done.
Read more about [Pull Requests](https://help.github.com/en/github/collaborating-with-issues-and-pull-requests/creating-a-pull-request).

### Development

`npm install && npm start` runs it from source. No build step for the main
process, `src/**` is plain CommonJS. `npm run dist:linux` produces installable
packages via electron-builder, see `electron-builder.yml`.

### Testing notes (2026-07-18, rewrite from C++ to Electron)

What's actually been exercised against a real WhatsApp account on a real
machine, not just read over: QR login, session persistence across restart,
chat list and message rendering, tray menu, `--quit`/`--show`/`--hide`/
`--refresh` remote commands, `.deb`/`.AppImage`/`.pacman` builds (installed
and inspected with `dpkg-deb --info` / `pacman -Qi`), zoom persisting across
restart, the phone dialog and shortcuts window actually opening and closing
(driven over the Chrome DevTools Protocol since no `xdotool`/`ydotool` was
available - dispatched real keyboard events through the real preload
pipeline, confirmed the resulting windows existed with the right content,
and confirmed `dispatchEvent()`'s return value to prove `preventDefault()`
actually ran rather than just assuming the dispatch landed), `F11`
fullscreen (screenshot-confirmed, full monitor takeover), the resource
monitor populating live data, `--profile` isolation with two accounts
running simultaneously against separate session directories, notification
permission grants, i18n end to end (forced `--lang=de`, confirmed window
titles and body text actually render translated, not just that the JSON
loads), screenshot-to-chat up to the point a real mouse is required (the
region-capture tool is correctly detected, the keyboard shortcut correctly
launches `slurp`, and cancelling that selection is handled without a crash -
the actual drag-a-region step can't be automated here), and that the
sender-verification IPC hardening doesn't block the legitimate windows from
calling their own handlers.

Bugs caught this way rather than by reading the code: the packaged AppImage
was fatally crashing a few seconds into every session from a Vulkan/Wayland
GPU-process incompatibility (fixed by disabling the Vulkan feature path);
`build/icons/` had never actually been bundled into packaged builds, so the
tray/window/dialog icons were silently broken in every install despite
`npm start` looking fine; and a `TypeError: Object has been destroyed`
crashed the main process on *every single window close* (`win.webContents.id`
was read inside the `closed` handler, after Electron had already torn the
window down) - this one shipped and a user hit it before it got caught,
because every close-path test up to that point only ever opened windows.
Fixed by capturing the id before registering the handler.

Not yet exercised: idle-reload firing after a real 4h+ idle period, a real
WhatsApp call end to end (needs a second account), `.rpm` (no `rpmbuild` in
the dev environment used to build this), `.snap` (needs the CI-only
`snapcore/action-build` wrapper). The release CI workflow itself has been
written and reasoned through but never actually run, only a push to the
`release` branch proves it. The 16 translation files are AI-generated and
haven't had a native-speaker accuracy review.

Tray icon registration (`StatusNotifierItem` over DBus) was confirmed absent
on one Wayland/Hyprland setup, and confirmed to be an environment-level
issue rather than an app bug (a completely unrelated Electron app on the same
machine had the same gap). Window hide/show and OS notifications work
regardless of whether the tray icon itself renders.


## Donations
Donations are accepted through [GitHub Sponsors](https://github.com/sponsors/Wahid7852)
and UPI (`wahidzk0091-1@oksbi`).


Thanks,
Wahid7852.
