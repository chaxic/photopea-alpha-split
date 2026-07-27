# Alpha Split for Photopea

A lightweight, client-side Photopea sidebar plugin that detects disconnected
opaque regions through the alpha channel, lets you fix the detection in an
interactive ID mask, exports each region as a cropped PNG, and can reimport and
position those PNGs as Smart Objects.

**Current version:** v1.3.6  
**Compatibility:** Tested with Photopea 5.6 · scripting v30  
**Last verified:** 28 July 2026

**Live plugin:** [chaxic.github.io/photopea-alpha-split](https://chaxic.github.io/photopea-alpha-split/?v=1.3.6)

## Features

- Connected-component detection on the active layer alpha channel
- Alpha threshold, minimum pixel size, and 4/8-connected controls
- Interactive ID mask with solid colour-coded label IDs
- **Sample** / **Fill** / **New** to join or separate elements before export
- Hover tooltip with element name and colour swatch; Fill mode shows a target outline
- **Randomize colors** and **Update** to commit the edited element list
- Export cropped PNGs to a remembered folder, or download a ZIP
- Dual metadata: hidden `AlphaSplit Data` PSD layer + `alpha-split-data.json`
- **Generate ID Mask** for a fresh detect; **Restore ID Mask** rematches stored boxes
- Instant schematic layout when data loads; **Load data layer** / **Load data file**
- **Import Elements** places folder PNGs; **Position Elements** places them from stored boxes
- Responsive preview canvas that scales with the panel width
- No server, account, or document upload

## Install

### Public GitHub Pages

1. Open the [installer page](https://chaxic.github.io/photopea-alpha-split/?v=1.3.6).
2. Download `alpha-split-photopea.json`.
3. In Photopea, open **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.
5. Open the panel and confirm the badge shows **v1.3.6**.

### Local development

1. Run `npm run dev` (serves at `http://127.0.0.1:4178`).
2. In Photopea, open **Window → Plugins → Add Plugin**.
3. Select `plugin.local.json` from this folder.
4. Confirm the panel shows **v1.3.6** and the α icon.

## Use

1. Select one image layer with transparent gaps between elements.
2. Choose **Generate ID Mask** for a fresh detect, or **Restore ID Mask** when
   Alpha Split data is loaded (auto from the document/folder, or via
   **Load data layer** / **Load data file**). Restore rematches real alpha
   shapes to stored element boxes and skips the slow PSD snapshot.
3. Optionally edit the mask (Sample / Fill / New / Update).
4. Choose a destination (**Folder** or **ZIP**) and **Export elements**.
5. Export writes PNGs plus `alpha-split-data.json`, and upserts a hidden
   `AlphaSplit Data` text layer in the PSD.
6. With Folder destination and a prior export, choose **Import Elements** to
   place each PNG as a Smart Object named after its file (`element_01`), then
   **Position Elements** to move them into one `{prefix}s` group at their
   stored positions.

Import and Position both modify the document. ID Mask capture leaves the layer
stack unchanged.

### How positions are stored

Each entry in `alpha-split-data.json` (and the `AlphaSplit Data` layer) records
the element's bounding box in full document pixels:

```json
{ "id": 1, "filename": "element_01.png", "x": 120, "y": 64, "width": 96, "height": 80 }
```

**Position Elements** matches `filename` (without `.png`) to the name of a pixel
layer and translates that layer so its top-left corner sits at `x`, `y`. Layers
still named `image`, or renamed by hand, are reported as missing. Text layers are
never matched, so the `AlphaSplit Data` layer cannot be moved by mistake.

Import records every layer that already exists before the first PNG is placed, so
it only ever renames and groups the Smart Objects it created itself.

## Development

Serve this folder with `npm run dev`. The installer appears in a normal browser
tab. When loaded by Photopea as an iframe, it automatically shows the compact
plugin panel.

No build step or runtime dependency is required. Run the automated checks with:

```bash
npm test
```

## Privacy

The plugin runs entirely in the browser. It communicates with Photopea through
Photopea's documented messaging interface; document and image data are not
uploaded to a server.

## License

MIT
