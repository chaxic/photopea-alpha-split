# Alpha Split for Photopea

A lightweight, client-side Photopea sidebar plugin that detects disconnected
opaque regions through the alpha channel, lets you fix the detection in an
interactive ID mask, exports each region as a cropped PNG, and can reassemble
those PNGs as Smart Objects.

**Current version:** v1.3.4  
**Compatibility:** Tested with Photopea 5.6 · scripting v30  
**Last verified:** 28 July 2026

**Live plugin:** [chaxic.github.io/photopea-alpha-split](https://chaxic.github.io/photopea-alpha-split/?v=1.3.4)

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
- **Assemble Elements** imports all folder PNGs, then positions them in one batch
- Workfile-safe capture via an independent temporary PSD snapshot
- Responsive preview canvas that scales with the panel width
- No server, account, or document upload

## Install

### Public GitHub Pages

1. Open the [installer page](https://chaxic.github.io/photopea-alpha-split/?v=1.3.4).
2. Download `alpha-split-photopea.json`.
3. In Photopea, open **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.
5. Open the panel and confirm the badge shows **v1.3.4**.

### Local development

1. Run `npm run dev` (serves at `http://127.0.0.1:4178`).
2. In Photopea, open **Window → Plugins → Add Plugin**.
3. Select `plugin.local.json` from this folder.
4. Confirm the panel shows **v1.3.4** and the α icon.

## Use

1. Select one image layer with transparent gaps between elements.
2. Choose **Generate ID Mask** for a fresh detect, or **Restore ID Mask** when
   Alpha Split data is loaded (auto from the document/folder, or via
   **Load data layer** / **Load data file**). Restore rematches real alpha
   shapes to stored element boxes.
3. Optionally edit the mask (Sample / Fill / New / Update).
4. Choose a destination (**Folder** or **ZIP**) and **Export elements**.
5. Export writes PNGs plus `alpha-split-data.json`, and upserts a hidden
   `AlphaSplit Data` text layer in the PSD.
6. With Folder destination and a prior export, choose **Assemble Elements** to
   import each PNG as a Smart Object, then position them all into one `{prefix}s`
   group at their saved bbox origins.

Assemble intentionally modifies the document. ID Mask capture remains workfile-safe.

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
