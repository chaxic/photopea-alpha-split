# Alpha Split for Photopea

A lightweight, client-side Photopea sidebar plugin that detects disconnected
opaque regions through the alpha channel and exports each as a cropped PNG.

**Current version:** v1.1.0  
**Compatibility:** Tested with Photopea 5.6 · scripting v30  
**Last verified:** 27 July 2026

## Features

- Connected-component detection on the active layer alpha channel
- Alpha threshold and minimum pixel size controls
- Colorized preview before exporting
- Workfile-safe preview via an independent temporary PSD snapshot
- Export cropped PNGs to a remembered folder, or download a ZIP
- Request IDs, stage progress, and failure timeouts
- No server, account, database, or document upload

## Install

### Local development

1. Run `npm run dev` (serves at `http://127.0.0.1:4178`).
2. In Photopea, open **Window → Plugins → Add Plugin**.
3. Select `plugin.local.json` from this folder.
4. Confirm the panel shows **v1.1.0** and the α icon.

### Public GitHub Pages

1. Open the [v1.1.0 installer page](https://chaxic.github.io/photopea-alpha-split/?v=1.1.0).
2. Download `alpha-split-photopea.json`.
3. In Photopea, open **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.
5. Open the panel and confirm that it shows **v1.1.0**.

## Use

1. Select one image layer with transparent gaps between elements.
2. Choose **Preview** to detect regions without changing the workfile.
3. Review the tinted preview and count.
4. Choose a destination (**Folder** or **ZIP**).
5. Choose **Export elements** to write one cropped PNG per region.

Export does not modify the original PSD. Previewing snapshots a temporary copy,
isolates the layer there, then closes only that temporary document. Folder
writes use the File System Access API via a secure picker window (remembered in
IndexedDB); if that is unavailable, use ZIP download.

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
