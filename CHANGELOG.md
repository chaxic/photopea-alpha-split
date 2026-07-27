# Changelog

All notable changes to Alpha Split for Photopea are documented here.

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
