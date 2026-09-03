# GIMBOZ 3D PULL

Enter a Gimboz token ID, get the 3D model. Live reference build: **https://gimboz-3d.vercel.app** (deep link `?id=1`).

Built for ape.church. Pure static, no backend, no API key, no wallet. Everything comes from the same public bucket the on-chain `tokenURI` points to.

## What it does

1. Fetches `https://storage.googleapis.com/gimboz-public/AjhoiwlksdnERUB/token/<id>.json` (this is exactly what `tokenURI(id)` on `0x81C9ce55E8214Fd0f5181FD3D38f52fD8c33Ec38` on ApeChain returns).
2. Reads the `image`, `glb` and `mml` fields out of that JSON.
3. Shows PFP + traits, spins the GLB in `<model-viewer>`.
4. Buttons: **Download GLB**, **Download VRM**, PFP PNG, metadata JSON, copy MML tag, copy GLB URL, share link, OpenSea / Apescan links.
5. "Where this comes from" panel shows the contract → tokenURI → `json.glb` chain and the raw JSON.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup. One CDN dependency: `@google/model-viewer` 4.0.0 (jsdelivr). |
| `styles.css` | Ape Church styling: `#8DFF00`, Nohemi Bold (self-hosted in `assets/`), dark ground. |
| `app.js` | Fetch metadata, render, downloads, recent IDs (`localStorage` key `gimboz-3d-recent`). |
| `vrm.js` | **GLB → VRM 0.x converter that runs in the browser.** See below. |
| `vercel.json` | Clean URLs + immutable cache on `assets/`. Not needed on other hosts. |
| `assets/` | Brand kit copies (logo lockup, logomark favicon, `NohemiBold.ttf`). |
| `tools/` | Offline scripts, not used by the site: Blender face-rig builder + QC renderer. |

## Dropping it into ape.church

It is three files plus assets. Options, easiest first:

- **Iframe** `https://gimboz-3d.vercel.app` (or your own deploy of this repo). Zero integration work.
- **Route**: copy `index.html`, `styles.css`, `app.js`, `vrm.js`, `assets/` into a `/3d` route. Strip the header/footer from `index.html` if the site already has its own chrome. Everything in `app.js` is scoped to element IDs, nothing global except `GimbozVRM` from `vrm.js`.
- **Component**: the logic in `app.js` is one `pull(id)` function and one `render()`; port to React/Vue in an afternoon. Keep `vrm.js` as-is, it is framework-free.

Requirements on the host: none. The bucket is `Access-Control-Allow-Origin: *` on both the JSON and the GLB, so any origin can fetch. If you add a CSP, allow `script-src cdn.jsdelivr.net` and `connect-src storage.googleapis.com`.

## The VRM converter (`vrm.js`)

Every Gimboz shares the same UE5 mannequin skeleton (79 bones), so a VRM humanoid bone map written once is correct for all 4443 tokens. `vrm.js` does pure JSON surgery on the glTF chunk of the GLB and rewraps it as a VRM 0.x file. No mesh, texture or skin data is touched, so it takes ~10 ms in the browser and nothing is uploaded anywhere.

```js
const { buffer, report } = GimbozVRM.convert(glbArrayBuffer, { title: 'Gimboz #1' });
// buffer  -> ArrayBuffer of the .vrm
// report  -> { mapped: [...bones], missing: [...], expressions: [...], flipped: true }
```

- Maps hips / spine / chest / upperChest / neck / head, shoulders, arms, hands, legs, feet, toes, and thumb + index + middle + ring (Gimboz have no little finger, so those are left unmapped).
- Binds morph targets named `A I U E O Blink Blink_L Blink_R Joy Angry Sorrow Fun` to VRM presets **if the GLB has them**. Stock GLBs have none, so stock VRMs are body-tracking only. Face-rigged GLBs (see `tools/`) get full expressions through the same converter.
- Yaws the root 180° because VRM 0.x models face -Z in glTF and the Gimboz GLBs face +Z. If you preview a converted VRM in a plain glTF viewer you will see its back; that is correct.
- Also works in Node (`require('./vrm.js')`) for batch or testing.

Verified loading in Warudo (stock and face-rigged, no errors in `Player.log`). Note that **Warudo lists VRMs by `meta.title`, not filename**, so the `title` option is what users see in the character dropdown; the site passes the on-chain name (`GIMBOZ #1014`).

## `tools/` (offline, optional)

- `build_face.py`: headless Blender 5.0 script that adds the 12 face shape keys and two eye bones to a Gimboz GLB. Cuts a seam along the lip line so the mouth actually opens (the stock model has a sealed skin over a full mouth interior). Run: `blender -b --python tools/build_face.py -- in.glb out.glb`. Currently hardcoded to token #1's mesh names; needs generalising before a batch.
- `qc_render.py`: renders every shape key to a contact sheet for eyeballing.

Plan is to batch these for all tokens and host rigged GLB + VRM alongside the stock ones, so the site offers both.

## Local dev

Any static server, e.g. `python -m http.server 8129` in this folder. Deploy is `vercel --prod --yes` or just upload the folder anywhere static.
