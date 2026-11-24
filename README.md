# birdar

Bird tracking proof of concept for Meta Quest 3. WebXR `immersive-ar` with passthrough.

The Quest Browser does not support the WebXR `camera-access` feature. The app gets the passthrough
camera through `getUserMedia`, the same as a webcam. The app then:

1. Draws each camera frame on a small canvas (320 px wide).
2. Finds bird pixels. A bird pixel:
   - is not sky colour (sky colour = bright, and blue or grey/white),
   - is darker than the local mean by `contrast`,
   - has mostly sky around it (`skyFrac` of the area in `skyRadius` is sky colour).
3. Joins bird pixels into blobs (connected components) and removes blobs that are too large or too thin.
4. Changes each blob centre into a world direction: camera ray, then calibration (yaw, pitch), then head pose.
5. Removes blobs below `minElev` degrees above the horizon (pool, tiles, ground).
6. Tracks the directions over time (greedy nearest angle, velocity prediction).
   A track is a bird only if it has `minHits` hits, a smooth path (`maxErr`) and moves `minMove` degrees.
   Static tree tips and roof corners never move. Random flicker is not smooth.
7. Shows a ring and a trail for each bird, 20 m away along its direction.

Birds are far away, so the small offset between the camera and the eyes has almost no effect. Only rotation is important.

## Files

| file | what |
|---|---|
| `index.html` | page, buttons, sliders |
| `app.js` | camera, WebXR session, three.js markers, HUD, controllers |
| `detect.js` | pure functions: image to blobs, pixel to world direction, tracker |
| `test.js` | `node test.js`, synthetic sky tests, no browser |
| `three.module.js`, `three.core.js` | three.js r187 (MIT, `three.LICENSE`) |

No build step. No CDN.

## Deploy

GitHub Pages, classic: push to `master`, then Settings → Pages → Deploy from a branch → `master` / `(root)`.
HTTPS is necessary for the camera and WebXR, and GitHub Pages gives HTTPS.
Cloudflare Pages also works (static, no functions necessary).

## Use on the Quest

1. Open the page in the Quest Browser.
2. Push **1. Start camera**. Allow the headset camera permission.
3. Push **2. Enter AR**.
4. Look at the sky. On the HUD: yellow boxes are blobs, coloured circles are birds,
   the dashed line is `minElev` above the horizon. The app ignores all blobs below the line.

If the browser asks for the permission again when you enter AR, allow it, reload the page, and do the steps again.

## Controls

| control | effect |
|---|---|
| right stick | camera yaw / pitch offset |
| left stick up/down | camera field of view |
| left stick left/right | contrast threshold |
| A | HUD on / off |
| B | reset calibration |
| X | latency compensation, 0 to 200 ms in steps of 40 |
| Y | clear tracks |

The app saves the settings in localStorage. You can also set settings in the URL, for example
`?fov=80&lag=100&contrast=30&minMove=4&cam=camera%201`. Refer to `DEF` in `app.js` for all keys.

## Calibration

The browser does not give camera intrinsics or the camera pose. The defaults are estimates (72° horizontal FOV, no offset).

1. Find a dark object on a bright background, for example a lamp post on the sky or a dark sticker on a white wall.
2. Hold your head still. Move the right stick until the ring is on the object.
3. Turn your head to put the object near the edge of the view. If the ring moves away from the object, change the FOV with the left stick.
   Also, the dashed line on the HUD must be parallel to the real horizon, a little above it.
4. Turn your head quickly. If the ring is late, push X to increase the latency compensation.

## Desktop test

The page also works on a desktop browser without AR. Use **Start camera** (webcam) or **Test with video file**
(a clip of birds on sky). The HUD on the page shows blobs and tracks. Use the sliders to tune the sky mask.

## Limits

- The app finds flying birds on sky only. It does not find birds on trees, buildings or water, or birds that sit still.
- No ML model. Dark moving spots on the sky (aircraft, insects near the lens) also become "birds".
- Bad calibration makes static objects seem to move when you turn your head. Then tree tips can become "birds".
  Calibrate first. If necessary, increase `minMove` in the URL.
- The distance to each ring is fixed (20 m). The direction is correct, but the distance is not.
- The video frame and the head pose are not synchronized exactly. The `lag` setting is an approximate fix.

Possible next step: put a small ONNX or TF.js COCO detector (class "bird") after the blob step, to classify each blob crop.

## Changes

- v2: sky colour test, sky fraction around each blob, horizon filter, tracker needs a smooth path and
  movement, 320 px processing, horizon line on the HUD. v1 found 40-60 false blobs per frame on tiles,
  pool and trees in full sun.
- v1: first version.
