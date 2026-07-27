# Alpha Split for Photopea

A lightweight, client-side Photopea sidebar plugin that detects disconnected
opaque regions through the alpha channel, lets you fix the detection in an
interactive preview, exports each region as a cropped PNG, and can reassemble
those PNGs as Smart Objects.

**Current version:** v1.3.1  
**Compatibility:** Tested with Photopea 5.6 · scripting v30  
**Last verified:** 27 July 2026

**Live plugin:** [chaxic.github.io/photopea-alpha-split](https://chaxic.github.io/photopea-alpha-split/?v=1.3.1)

## Features

- Connected-component detection on the active layer alpha channel
- Alpha threshold, minimum pixel size, and 4/8-connected controls
- Interactive preview with solid colour-coded label IDs
- **Sample** / **Fill** / **New** to join or separate elements before export
- Hover tooltip with element name and colour swatch; Fill mode shows a target outline
- **Randomize colors** and **Update** to commit the edited element list
- Export cropped PNGs to a remembered folder, or download a ZIP
- Dual metadata: hidden `AlphaSplit Data` PSD layer + `alpha-split-data.json`
- **Assemble Elements** reimports folder PNGs as Smart Objects at bbox positions
- Workfile-safe preview via an independent temporary PSD snapshot
- Responsive preview canvas that scales with the panel width
- No server, account, or document upload

## Install

### Public GitHub Pages

1. Open the [installer page](https://chaxic.github.io/photopea-alpha-split/?v=1.3.1).
2. Download `alpha-split-photopea.json`.
3. In Photopea, open **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.
5. Open the panel and confirm the badge shows **v1.3.1**.

### Local development

1. Run `npm run dev` (serves at `http://127.0.0.1:4178`).
2. In Photopea, open **Window → Plugins → Add Plugin**.
3. Select `plugin.local.json` from this folder.
4. Confirm the panel shows **v1.3.1** and the α icon.

## Use

1. Select one image layer with transparent gaps between elements.
2. Choose **Preview** to detect regions without changing the workfile.
3. Optionally edit the preview (Sample / Fill / New / Update).
4. Choose a destination (**Folder** or **ZIP**) and **Export elements**.
5. Export writes PNGs plus `alpha-split-data.json`, and upserts a hidden
   `AlphaSplit Data` text layer in the PSD (settings restore on reopen).
6. With Folder destination and a prior export, choose **Assemble Elements** to
   place each PNG back into the document as a Smart Object at its original bbox.

Assemble intentionally modifies the document. Preview capture remains workfile-safe.

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Released under the [MIT License](LICENSE). Personal and commercial use,
modification, and redistribution are allowed. If you distribute copies or
substantial portions of the code, retain the copyright and license notice.
