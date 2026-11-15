---
name: publish-preview
description: Render a self-contained HTML preview of a rig page, publish it to the separate rig-preview GitHub Pages host, verify the public HTTPS link, and overwrite it without LANE_MARKER after review.
---

# publish-preview

Publishes a short-lived static HTML preview of a `rig` route to the separate `rig-preview` GitHub Pages repository (ADR 0003).

## Steps

1. Ask the human before publishing the preview with `LANE_MARKER` set, stating what it is, why, where, who can see it, and how to undo it.
2. Render the target route with `LANE_MARKER` set into `/tmp/<slug>.html` using `tsx --tsconfig tsconfig.json --env-file=.env`.
3. Copy `/tmp/<slug>.html` into `/tmp/rig-preview/`, commit, and push to `origin main` on the separate `rig-preview` GitHub Pages repository.
4. Fetch the public `https://<owner>.github.io/rig-preview/<slug>.html` URL with `curl -fsSL` to verify it returns 200 and contains the expected HTML before sending the link to the reviewer.
5. Keep the preview issue open while waiting for the reviewer.
6. Once the reviewer confirms they have looked, ask the human for approval to overwrite the preview without `LANE_MARKER`.
7. Render the route again with `LANE_MARKER` unset (`no marker set`), amend and `git push -f origin main` on `rig-preview`, and verify with `curl -fsSL` that the public link no longer shows the marker.
