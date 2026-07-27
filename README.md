# Alpha Split for Photopea

A lightweight, client-side Photopea sidebar plugin that detects disconnected
opaque regions through the alpha channel and copies each into its own layer.

**Current version:** v1.0.3  
**Compatibility:** Tested with Photopea 5.6 · scripting v30  
**Last verified:** 27 July 2026

## Features

- Connected-component detection on the active layer alpha channel
- Alpha threshold and minimum pixel size controls
- Colorized preview before changing the document
- Workfile-safe scan via an independent temporary PSD snapshot
- Optional result group and source-layer hide after split
- Request IDs, stage progress, and failure timeouts
- No server, account, database, or document upload

## Install

### Local development

1. Run `npm run dev` (serves at `http://127.0.0.1:4178`).
2. In Photopea, open **Window → Plugins → Add Plugin**.
3. Select `plugin.local.json` from this folder.
4. Confirm the panel shows **v1.0.3** and the α icon.

### Public GitHub Pages

1. Open the [v1.0.3 installer page](https://chaxic.github.io/photopea-alpha-split/?v=1.0.3).
2. Download `alpha-split-photopea.json`.
3. In Photopea, open **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.
5. Open the panel and confirm that it shows **v1.0.3**.

## Use

1. Select one image layer with transparent gaps between elements.
2. Choose **Preview** to detect regions without changing the workfile.
3. Review the tinted preview and count.
4. Choose **Split into layers** to create one layer per region.

Splitting intentionally adds layers (and can hide the source). Previewing does
not modify the original document: it snapshots a temporary copy, isolates the
layer there, then closes only that temporary document.

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
