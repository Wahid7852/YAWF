# YAWF

**Y**et **A**nother **W**hatsApp **F**ork — an unofficial WhatsApp desktop client
for Linux, written in C++ with gtkmm and WebKitGTK. A maintained fork of
[xeco23/WasIstLos](https://github.com/xeco23/WasIstLos).

![App Window](screenshot/app.png)

[![Action Status](https://github.com/Wahid7852/YAWF/workflows/Linter/badge.svg)](https://github.com/Wahid7852/YAWF/actions/workflows/linter.yml)
[![Action Status](https://github.com/Wahid7852/YAWF/workflows/Build/badge.svg)](https://github.com/Wahid7852/YAWF/actions/workflows/build.yml)
[![Action Status](https://github.com/Wahid7852/YAWF/workflows/Release/badge.svg)](https://github.com/Wahid7852/YAWF/actions/workflows/release.yml)


## About

YAWF wraps WhatsApp Web in a native WebKitGTK window and adds desktop integration
(tray, notifications, autostart) plus a set of power-user features you don't get
in the browser. It focuses on **reliability** (it recovers on its own when
WhatsApp Web crashes) and **productivity** (clipboard image paste, Telegram-style
formatting shortcuts, screenshot-to-chat).


## Features

### Desktop integration
* Everything WhatsApp Web offers, in a dedicated window
* System tray icon, notification sounds, autostart with the system
* Fullscreen mode and show/hide header bar (*Alt+H*)
* Zoom in/out, configurable minimum font size and theme tweaks
* Multiple accounts via `--profile <name>` (isolated session per profile)
* Localization and spell checking in your system language (install the matching
  dictionary, e.g. `hunspell-en_us`)
* Open a chat directly by phone number

### Reliability
* **Auto-recovery**: if WhatsApp Web hits its "We encountered a problem"
  crash screen, the app reloads itself automatically (with a backoff so it
  never loops endlessly)
* Software-decode video workaround for glitchy hardware video paths
* Web-browser cache model so reloads come back quickly from disk

### Power-user shortcuts
| Shortcut | Action |
| --- | --- |
| `Ctrl+V` / `Ctrl+Shift+V` | Paste an image from the clipboard into the composer |
| `Ctrl+Shift+S` | Capture a screen region and drop it straight into the chat |
| `Ctrl+B` | Wrap selection in `*bold*` |
| `Ctrl+I` | Wrap selection in `_italic_` |
| `Ctrl+Shift+X` | Wrap selection in `~strikethrough~` |
| `Ctrl+Shift+M` | Wrap selection in ` ```monospace``` ` |
| `Ctrl+Shift+N` | Clear formatting from the selection |

* **Clipboard image paste** works even where WhatsApp Web's own paste does not —
  copy a screenshot and paste it directly.
* **Screenshot to chat** auto-detects your desktop's region-capture tool
  (Spectacle on KDE, gnome-screenshot on GNOME, grim + slurp on wlroots, or
  maim/flameshot/ImageMagick on X11).
* **Send with Ctrl+Enter** (optional, off by default): enable it in Preferences
  to make *Enter* insert a newline and *Ctrl+Enter* send the message.

The full list is always available in-app via *Ctrl+?*.


## Install

Grab a `.deb`, `.AppImage`, or `.snap` from the
[Releases](https://github.com/Wahid7852/YAWF/releases) page, or use a package
channel:

* **Arch (AUR)**: `yay -S yawf` — packaging in [`packaging/aur`](packaging/aur)
* **Flatpak / Flathub**: manifest in [`packaging/flatpak`](packaging/flatpak) *(submission in progress)*
* **Snap**: `snap install yawf` *(publishing in progress)*

> Migrating from WasIstLos? On first launch YAWF copies your existing
> `wasistlos` config, session and settings over, so you stay logged in.


## Dependencies

* cmake >= 3.12
* intltool
* gtkmm-3.0
* webkit2gtk-4.1
* ayatana-appindicator3-0.1
* libcanberra
* libhunspell (optional, for spell checking)
* A region-screenshot tool for *Ctrl+Shift+S* (optional): one of `spectacle`,
  `gnome-screenshot`, `grim`+`slurp`, `maim`, `flameshot`, or ImageMagick


## Build & Run

```bash
# Create a debug build directory and go into it
mkdir -p build/debug && cd build/debug

# Build the project
cmake -DCMAKE_BUILD_TYPE=Debug -DCMAKE_INSTALL_PREFIX=/usr ../..
make -j4

# Run
./yawf
```

> [!NOTE]
> The GTK `.ui` resources are compiled at CMake **configure** time. If you change
> a file under `resource/ui/`, re-run `cmake` before building so the change is
> embedded.

### Local installation

```bash
# Run inside the build directory once the application is built (needs root)
make install
```

> [!TIP]
> To keep a distro package from overwriting your build, install to `/usr/local`
> (configure with `-DCMAKE_INSTALL_PREFIX=/usr/local`). It wins on `PATH` and
> `XDG_DATA_DIRS`, and your package manager never touches `/usr/local`.


## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Application sources (`ui/`, `util/`) |
| `resource/` | GTK `.ui`, icons, desktop entry & AppStream metainfo, logo SVG sources |
| `po/` | Translations |
| `packaging/` | `appimage/`, `aur/`, `flatpak/` recipes |
| `debian/`, `snap/` | Kept at the repo root because `dpkg-buildpackage` and `snapcraft` require them there |

## Packaging

YAWF ships as its own package (`yawf`, app-id `io.github.wahid7852.YAWF`) — it does
not replace or conflict with the upstream `wasistlos` package. See
[`RELEASING.md`](RELEASING.md) for how a release is cut and shipped to each channel.


## Roadmap / To-Do

* Publish to Flathub and the Snap Store; submit/maintain the AUR package
* Debian/Ubuntu PPA for easy `apt` installs
* Translate the new UI strings (formatting shortcuts, preferences) into all locales
* Optional global hotkey to show/hide the window from the tray
* Per-chat notification controls and quiet hours
* Theme polish and a few more built-in themes
* CI: validate the `.desktop` and AppStream metainfo on every PR
* Automated snap/flatpak build checks in CI


## Contributing

Please read [contributing](CONTRIBUTING.md).

### Contributors

* [Wahid7852](https://github.com/Wahid7852) — maintainer of this fork
* [xeco23 (Enes Hecan)](https://github.com/xeco23) and the original WasIstLos
  [contributors](https://github.com/xeco23/WasIstLos/graphs/contributors)

[![Code Contributors](https://contrib.rocks/image?repo=Wahid7852/YAWF)](https://github.com/Wahid7852/YAWF/graphs/contributors)


## Credits

YAWF is a fork of the original [WasIstLos](https://github.com/xeco23/WasIstLos)
by [xeco23 (Enes Hecan)](https://github.com/xeco23) and contributors. All credit
for the original application goes to them. Licensed under GPL-3.0.
