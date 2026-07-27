# Changelog

All notable changes to Alpha Split for Photopea are documented here.

## [1.3.8] - 2026-07-28

### Fixed

- **Generate ID Mask** (and Restore’s light-capture fallback) no longer hang when
  Free Transform is still open after Import. Capture scripts commit the active
  transform before `saveToOE` / layer export.
- Binary exports delivered as TypedArray views are accepted, not only raw
  `ArrayBuffer`s.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.7] - 2026-07-28

### Added

- **Export** writes `alpha-split-id-mask.png` beside the cropped PNGs and JSON
  (folder and ZIP). The file encodes each label id in RGB so Restore can reload
  the exact edited mask without a Photopea capture. `alpha-split-data.json`
  records the filename in `idMask`.

### Changed

- **Restore ID Mask** loads `alpha-split-id-mask.png` from the export folder when
  present (and dimensions match the stored document). If the file is missing or
  invalid, Restore falls back to the previous light-capture + box rematch path.
- Export after a mask-only Restore light-captures the active layer for crop
  pixels, then writes PNGs, the ID mask, and JSON.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.6] - 2026-07-28

### Fixed

- **Import Elements** no longer hangs on the first element. Two causes:
  1. Layers were moved into the group with `ElementPlacement.INSIDE`, which is
     an illegal argument for a group target and aborted the script mid-run, so
     no reply ever came back and the panel spun forever. Layers now move relative
     to a child of the group (a temporary anchor layer is used when the group is
     empty) and membership is verified afterwards instead of assuming a call that
     did not throw worked.
  2. `app.open(..., true)` leaves Free Transform open; later rename scripts could
     hang forever. Import now commits Free Transform before naming, prefers a
     fresh `"image"` layer over leftovers, and retries naming if Photopea's
     `"done"` arrives without an `import-placed` echo.
- Import can no longer rename or move layers it did not place. Every existing
  layer is recorded before the first PNG is placed, and a layer is claimed only
  when it is an untracked pixel layer named `image` (or already named for the
  element). Previously the "first unknown layer wins" fallback could rename the
  hidden `AlphaSplit Data` layer to `element_01` and drag it into the group.
- **Position Elements** skips text layers when matching names, so a stray text
  layer cannot be moved in place of a missing element.
- The `AlphaSplit Data` layer is found by its contents when its name has been
  changed, and the name is repaired on the next save.

### Changed

- Import steps now use a 45 second per-step timeout instead of one long
  whole-job timeout, and a step that never produces a layer reports the names
  Photopea actually created instead of failing blind.

## [1.3.5] - 2026-07-28

### Changed

- **Assemble Elements** is now **Import Elements** and **Position Elements**.
  Import places and names each PNG; Position matches layers by name and moves
  them to the bounding-box origins stored in `alpha-split-data.json`, so a
  dropped message can no longer leave elements unpositioned.
- **Restore ID Mask** exports the isolated active layer straight from the
  workfile instead of taking a full PSD snapshot, which removes the slow
  snapshot/temp-document round trip on large sheets. Layer visibility is put
  back in the same script. Generate ID Mask keeps the PSD snapshot path.

### Fixed

- Import verifies the rename to `element_NN` and fails loudly instead of
  leaving Smart Objects named `image`.
- Data files are rejected when an element is missing its bounding-box size, so
  Position always has both an origin and a size to work from.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.4] - 2026-07-28

### Fixed

- Assemble capture finds newly placed `"image"` Smart Objects by id (not just
  `activeLayer`), and batch completion waits for `assemble-batch` so the last
  capture `"done"` can no longer skip positioning.
- Batch finish resolves layers by id or name and reports failed placements.

### Added

- **Generate ID Mask** / **Restore ID Mask** replace Preview: restore rematches
  stored element boxes; generate starts from a fresh detect.
- Loading Alpha Split data (auto, **Load data layer**, or **Load data file**)
  shows an instant schematic layout; Restore builds the editable mask.
- JSON file picker for `alpha-split-data.json` when folder access is unavailable.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.3] - 2026-07-28

### Fixed

- Assemble imports every PNG first (recording layer ids), then positions them in
  one batch script — fewer round trips and no more stall on “Positioning 1/N”.
- Preview restore matches fresh alpha shapes to stored element boxes instead of
  painting rectangles, removing the blue box artefacts on reopen.
- Clearer Preview status text during the slow 8K snapshot / temp / PNG stages.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.2] - 2026-07-28

### Fixed

- Assemble Elements waits for Photopea to finish placing each Smart Object before
  rename/move/translate, so layers land in one `{prefix}s` group at the correct
  bbox positions instead of nested folders piled at the canvas centre.
- Preview restores the previous element layout from `AlphaSplit Data` / folder
  JSON when present, so Sample/Fill/Update can continue from the last export
  instead of a fresh (and different) downscaled detect.

### Verification

- Automated checks passed on 28 July 2026.

## [1.3.1] - 2026-07-28

### Fixed

- Opening the panel no longer shows a working spinner or blocks the buttons: the
  settings restore read is deferred, silent, and retried once, so a Photopea
  that is not yet accepting scripts can no longer leave the panel stuck.
- Data-layer reads and writes now use their own tokens and timeouts instead of
  the shared request slot, so they cannot hijack or stall Export.
- Brighter sidebar icon to match the other Photopea plugin icons.

## [1.3.0] - 2026-07-27

### Added

- Dual metadata persistence: hidden `AlphaSplit Data` text layer in the PSD and
  `alpha-split-data.json` in the export folder (also included in ZIP exports).
- Settings restore from the PSD data layer (with folder JSON fallback).
- **Assemble Elements** reimports exported folder PNGs as Smart Objects at their
  bounding-box positions, grouped under `{prefix}s`.

### Verification

- Automated checks passed on 27 July 2026.

## [1.2.5] - 2026-07-27

### Fixed

- Preview hit-testing and hover tip stay aligned when the panel is resized
  (canvas now fits the card with correct aspect ratio instead of CSS stretch).
- Fill-mode outline is thicker and scales with display density.

## [1.2.4] - 2026-07-27

### Fixed

- Sidebar icon brightness now matches other Photopea plugins by using black
  strokes so Photopea can tint them for the dark UI.

## [1.2.3] - 2026-07-27

### Changed

- Plugin sidebar icon now uses thin outline strokes to match Photopea's native
  plugin icon style.

## [1.2.2] - 2026-07-27

### Fixed

- Preview label colours are now solid and opaque instead of a 50% tint over the artwork.

## [1.2.1] - 2026-07-27

### Fixed

- Sampling no longer tints the whole element on the canvas.
- Hover tooltip now shows element name and colour swatch.
- Fill mode previews the target island with a white outline before click.

## [1.2.0] - 2026-07-27

### Added

- Interactive preview editing: **Sample**, **Fill**, **New**, **Randomize colors**,
  and **Update**.
- Join elements by sampling one label and filling another island.
- Separate islands by filling with a new label.
- Responsive preview canvas that scales with the panel width.

### Changed

- Export propagates edited analysis labels to full resolution instead of
  discarding preview edits.
- Uncommitted preview edits must be committed with **Update** before Export.

### Verification

- Automated checks passed on 27 July 2026.

## [1.1.0] - 2026-07-27

### Changed

- Replaced in-document **Split into layers** with **Export elements**.
- Cropped PNGs are encoded entirely in the panel and written to a chosen folder
  or downloaded as a ZIP — no Photopea place round-trips.
- Removed “Put results in a group” and “Hide source layer” options.

### Added

- Folder destination with remembered directory handle (IndexedDB) and a secure
  picker window for Photopea’s cross-origin iframe.
- ZIP download destination as a reliable fallback.

### Verification

- Automated checks passed on 27 July 2026.

## [1.0.3] - 2026-07-27

### Changed

- Preview now analyses a downscaled copy (max 2048px on the long side) so 8K
  sheets stay responsive.
- Split rebuilds masks at full resolution once, then places cropped layers.
- Timeouts scale with document megapixels and element count.

### Verification

- Automated checks passed on 27 July 2026.

## [1.0.2] - 2026-07-27

### Fixed

- Split was extremely slow on large documents because each element was encoded
  as a full-document PNG (for example 8192×8192). Elements are now cropped to
  their bounding boxes and positioned after placement.
- Preview rendering no longer builds a full-resolution canvas; it downscales to
  at most 512px on the long side.

### Verification

- Automated checks passed on 27 July 2026.

## [1.0.1] - 2026-07-27

### Fixed

- Scan/Preview no longer fails with "Photopea did not return a PSD snapshot"
  when Photopea's script-complete `"done"` arrived before the snapshot binary.

### Changed

- Renamed the primary discovery action to **Preview**.
- Preview panel now shows a clear detected-element count before splitting.

### Verification

- Automated checks passed on 27 July 2026.

## [1.0.0] - 2026-07-27

### Added

- Scan active-layer alpha regions with threshold and minimum size controls.
- Colorized preview of detected connected components before applying.
- Split each detected region into its own named layer.
- Optional result group and source-layer hide after split.
- Workfile-safe scan using an independent temporary PSD snapshot.
- Visible plugin version, Photopea 5.6 / scripting v30 compatibility, and
  GitHub source link.
- Request IDs, stage progress, and a failure timeout.
- Automated checks for detection rules, manifest URLs, icon prefix, and version
  consistency.

### Verification

- Automated checks passed on 27 July 2026.
- Installer JSON uses the `===` icon URL prefix required by Photopea.
