# Changelog

All notable changes to Alpha Split for Photopea are documented here.

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
