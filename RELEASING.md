# Releasing

YAWF's version lives in `package.json`, all package metadata derives from it.

## Cut a release

1. Bump `version` in `package.json` and add a matching top entry to
   `CHANGELOG.md`.
2. Merge to `master`, then push the **`release`** branch:
   ```bash
   git push origin master:release
   ```
   The `Release` workflow (`.github/workflows/release.yml`) builds the `.deb`,
   `.AppImage`, `.rpm`, and `.pacman` packages, tags `vX.Y.Z`, and creates the
   GitHub Release with a generated changelog and the artifacts attached.
   Snap isn't built by this workflow, see the note in `README.md`.

## Per-channel publishing

All store publishing is manual, the `Release` workflow only builds artifacts
and attaches them to the GitHub Release.

### AUR

Update `pkgver` and the real `sha256sums` in `packaging/aur/PKGBUILD`
(`updpkgsums`), regenerate `.SRCINFO` (`makepkg --printsrcinfo > .SRCINFO`),
and push to the `yawf-bin` AUR repo.

### Snap Store, Flathub, Launchpad PPA

Not currently set up. The old C++ build had a manual publishing flow for
these, this rewrite hasn't had it rebuilt yet, see the "Known gaps" section
in `README.md`.

## Pre-release checks

```bash
npm ci
npm run dist:linux
desktop-file-validate dist/linux-unpacked/*.desktop 2>/dev/null || true
```
