# Proposal: publishing the web app on GitHub Pages

Status: **proposal, not deployed.** Nothing here runs by itself: publishing needs a person to run
the commands below (or to move the workflow template into `.github/workflows/`) after review.

## What gets published

`npm run build` in `web/` writes a static site to `web/dist/` (about 15 MB per video):

| Path | Page |
|---|---|
| `index.html` | *Earth Information Jukebox*: video picker + player, English by default, Spanish available |
| `data/jukebox/catalog.json` | the list of published videos (written by `video_jukebox/jukebox.py build`) |
| `media/`, `data/` | per video: video, audio stems, timeline and manifest (copied from `web/public/`) |
| `assets/` | JavaScript and CSS bundles |

Vite is configured with `base: "./"`, so every URL in the built HTML is relative (`./assets/…`,
`./index.html`) and the manifest paths are relative to the page. The site works from any
subfolder, such as `https://<user>.github.io/SpaceAppChallenge2026/`, without rebuilding.
`build_web.py` also checks that the jukebox assets exist and are relative
(`python video_jukebox/build_web.py --check-only` for every video in the catalog).

The largest files are the videos (`media/jukebox/ecco2.mp4` 10 MB; each video has a 12 MB
budget), well below the 100 MB per-file and 1 GB per-site limits of GitHub Pages. Do not publish
test videos (`jukebox.py add --test`): remove them first with `jukebox.py remove <id>`.

NASA credits are part of the pages themselves, not of the deployment: each video shows its
credits (with authors and links) and the "not endorsed by NASA" notice in both languages.

## Option A (recommended for the fork): a `gh-pages` branch built locally

It does not touch `main` or `video-jukebox` and does not need GitHub Actions. From the
repository root, with the reviewed commit checked out:

```bash
cd web && npm ci && npm test && npm run build && cd ..
touch web/dist/.nojekyll                      # serve files as they are, no Jekyll

git worktree add --detach ../pages-build
cd ../pages-build
git checkout --orphan gh-pages
git rm -rf --quiet .
cp -R ../SpaceAppChallenge2026/web/dist/. .
git add -A
git commit -m "Pages: web build of $(git -C ../SpaceAppChallenge2026 rev-parse --short HEAD)"
# Only after review:
# git push fork gh-pages
cd ../SpaceAppChallenge2026 && git worktree remove ../pages-build
```

Then, in the fork on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a
branch → `gh-pages` / `(root)`**. The site would be at:

- `https://honokahk.github.io/SpaceAppChallenge2026/` (the jukebox; `?video=<id>` opens a video)

To update it, repeat the steps (the branch only ever holds the latest build); to take it down,
disable Pages in the same settings page.

## Option B (for the original repository): manual GitHub Actions workflow

[`docs/pages-workflow.yml`](pages-workflow.yml) is a template that builds `web/`, runs the web tests
and deploys `web/dist` with the official Pages actions. It only has a `workflow_dispatch` trigger,
so it never runs on push. It is kept in `docs/` on purpose: it only becomes active if the
repository owner copies it to `.github/workflows/pages.yml` on the default branch and sets
**Settings → Pages → Source: GitHub Actions**. That decision belongs to the owner of the
repository where the site is published.

## Checks after deploying

```bash
SITE=https://honokahk.github.io/SpaceAppChallenge2026
# Pages are served and relative assets resolve under the subfolder
curl -sI "$SITE/index.html" | head -1
curl -sI "$SITE/data/jukebox/catalog.json" | grep -i content-type        # application/json
# Range requests (the video element and seeking depend on them): expect 206 and Content-Range
curl -sI -H "Range: bytes=0-1023" "$SITE/media/jukebox/ecco2.mp4" | grep -iE "^HTTP|content-range|content-type"
curl -sI "$SITE/media/jukebox/ecco2_temperatura.m4a" | grep -i content-type   # audio/mp4 (or audio/x-m4a)
```

In a browser, on the published page:

1. It opens in English; *Español* switches the page and `?lang=es` opens it in Spanish. The
   *Video* picker lists every video of the catalog; `?video=<id>` opens one directly.
2. Play, jump with the slider, the piano roll and a chart: the video stays in sync (the *Audio–video
   sync (diagnostics)* panel shows the drift).
3. With DevTools network throttling, jump to a part that is not downloaded yet: the music waits and
   the notice appears; it resumes when the video catches up.
4. The credits and the visual-proxy warnings are visible in both languages.

## Known limits

- Each video downloads about 5–15 MB (video + four stems); the audio must be fully decoded before
  playback starts. Changing video reloads the page.
- GitHub Pages does not let us set cache headers; files have content hashes only under `assets/`.
