# Releasing

YAWF's version lives in `CMakeLists.txt` (`project(... VERSION x.y.z)`); all
package metadata derives from it.

## Cut a release

1. Bump `VERSION` in `CMakeLists.txt` and add a matching top entry to
   `CHANGELOG.md`, the AppStream `<releases>` block in
   `resource/desktop/io.github.wahid7852.YAWF.metainfo.xml.in`, and a new
   `debian/changelog` stanza.
2. Merge to `master`, then push the **`release`** branch:
   ```bash
   git push origin master:release
   ```
   The `Release` workflow (`.github/workflows/release.yml`) builds the `.deb`,
   `.snap` and `.AppImage`, tags `vX.Y.Z`, and creates the GitHub Release with a
   generated changelog and the artifacts attached.

## Per-channel publishing

All store publishing is manual. The `Release` workflow only builds artifacts
and attaches them to the GitHub Release.

### Snap Store

```bash
snapcraft upload --release=stable yawf_*.snap
```

Sensitive interfaces (`system-observe`, `process-control`, `browser-support`)
trigger a manual review on first submission — wait for Store team approval,
then promote to stable via the dashboard.

### Launchpad PPA (`ppa:wahid2584/yawf`)

```bash
# Stamp changelog for the target series and build a signed source package
VERSION=x.y.z
sed -i "1s|($VERSION) stable;|($VERSION~noble1) noble;|" debian/changelog
debuild -S -sa -k C51AF2B42BC70DA7
dput ppa:wahid2584/yawf ../yawf_${VERSION}~noble1_source.changes
# Reset changelog afterwards
git checkout debian/changelog
```

Launchpad builds the binary server-side; the PPA page shows build status.

### AUR

Update `pkgver` and the real `sha256sums` in `packaging/aur/PKGBUILD`
(`updpkgsums`), regenerate `.SRCINFO` (`makepkg --printsrcinfo > .SRCINFO`),
and push to the `yawf` AUR repo.

### Flathub

Fill in real `sha256`/commits in `packaging/flatpak/io.github.wahid7852.YAWF.yml`,
test with `flatpak-builder`, then open a PR to the `flathub/flathub` repo.

## Pre-release checks

```bash
cmake -S . -B build && cmake --build build
desktop-file-validate build/resource/io.github.wahid7852.YAWF.desktop
appstreamcli validate build/resource/io.github.wahid7852.YAWF.metainfo.xml
```
