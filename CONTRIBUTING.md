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
restart, the phone dialog and shortcuts window actually opening (driven over
the Chrome DevTools Protocol since no `xdotool`/`ydotool` was available,
dispatched real keyboard events through the real preload pipeline and
confirmed the resulting windows existed with the right content), the
resource monitor populating live data, `--profile` isolation with two
accounts running simultaneously against separate session directories,
notification permission grants, and that the sender-verification IPC
hardening doesn't block the legitimate windows from calling their own
handlers.

Two real bugs were caught this way rather than by reading the code: the
packaged AppImage was fatally crashing a few seconds into every session from
a Vulkan/Wayland GPU-process incompatibility (fixed by disabling the Vulkan
feature path), and `build/icons/` had never actually been bundled into
packaged builds, so the tray/window/dialog icons were silently broken in
every install despite `npm start` looking fine.

Not yet exercised: `F11` fullscreen (same simple IPC path as zoom and the
phone dialog, both verified, so high confidence, just not visually
confirmed), screenshot-to-chat with a real region selection, idle-reload
firing after a real 4h+ idle period, a real WhatsApp call end to end (needs a
second account), `.rpm` (no `rpmbuild` in the dev environment used to build
this), `.snap` (needs the CI-only `snapcore/action-build` wrapper). The
release CI workflow itself has been written and reasoned through but never
actually run, only a push to the `release` branch proves it.

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
