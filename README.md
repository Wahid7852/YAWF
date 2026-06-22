# WasIstLos

An unofficial WhatsApp desktop application for Linux — a maintained revival fork
of [xeco23/WasIstLos](https://github.com/xeco23/WasIstLos), written in C++ with
gtkmm and WebKitGTK.

![App Window](screenshot/app.png)

[![Action Status](https://github.com/Wahid7852/WasIstLos/workflows/Linter/badge.svg)](https://github.com/Wahid7852/WasIstLos/actions/workflows/linter.yml)
[![Action Status](https://github.com/Wahid7852/WasIstLos/workflows/Build/badge.svg)](https://github.com/Wahid7852/WasIstLos/actions/workflows/build.yml)
[![Action Status](https://github.com/Wahid7852/WasIstLos/workflows/Install/badge.svg)](https://github.com/Wahid7852/WasIstLos/actions/workflows/install.yml)
[![Action Status](https://github.com/Wahid7852/WasIstLos/workflows/Release/badge.svg)](https://github.com/Wahid7852/WasIstLos/actions/workflows/release.yml)


## About

WasIstLos wraps WhatsApp Web in a native WebKitGTK window and adds desktop
integration (tray, notifications, autostart) plus a set of power-user features
you don't get in the browser. This fork focuses on **reliability** (it recovers
on its own when WhatsApp Web crashes) and **productivity** (clipboard image
paste, Telegram-style formatting shortcuts, screenshot-to-chat).


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


## Using WasIstLos

The upstream project is available from a number of Linux distributions:

[![Packaging status](https://repology.org/badge/vertical-allrepos/wasistlos.svg)](https://repology.org/project/wasistlos/versions)


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

### Development

```bash
# Create a debug build directory and go into it
mkdir -p build/debug && cd build/debug

# Build the project
cmake -DCMAKE_BUILD_TYPE=Debug -DCMAKE_INSTALL_PREFIX=/usr ../..
make -j4

# Optionally, to update the default translation file
make update-translation

# Run
./wasistlos
```

> [!NOTE]
> The GTK `.ui` resources are compiled at CMake **configure** time. If you change
> a file under `resource/ui/`, re-run `cmake` before building so the change is
> embedded.

### Local installation

```bash
# Run inside the build directory once the application is built
# You'll probably need administrator privileges for this
make install
```

> [!TIP]
> If a distro package already owns `/usr/bin/wasistlos` and you don't want a
> system upgrade to overwrite your build, install to `/usr/local` instead
> (configure with `-DCMAKE_INSTALL_PREFIX=/usr/local`). It wins on `PATH` and
> `XDG_DATA_DIRS`, and your package manager never touches `/usr/local`.

### Uninstall

```bash
# Run inside the build directory if you want to uninstall all files
# install_manifest.txt file is created when you run make install
xargs rm < install_manifest.txt
```


## Packaging

### Debian

```bash
# Don't forget to update the version number (0) in debian/changelog before this
# Build the package.
dpkg-buildpackage -uc -us -ui
```

### Snap

```bash
# Build the package. Pass --use-lxd option in a virtual environment
snapcraft
```

### AppImage

```bash
# Make sure that the application is installed into the `<Project Root>/AppDir` directory
make install DESTDIR=../../AppDir

# Build the package
appimage-builder --skip-test --recipe ./appimage/AppImageBuilder.yml
```


## Contributing

Please read [contributing](CONTRIBUTING.md).

### Code Contributors

[![Code Contributors](https://opencollective.com/WasIstLos/contributors.svg?width=880&button=false)](https://github.com/Wahid7852/WasIstLos/graphs/contributors)


## Credits

This is a fork of the original [WasIstLos](https://github.com/xeco23/WasIstLos)
by [xeco23](https://github.com/xeco23) and contributors. All credit for the
original application goes to them.
