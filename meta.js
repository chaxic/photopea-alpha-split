(function (root, factory) {
  var meta = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = meta;
  }

  root.ALPHA_SPLIT_META = meta;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return Object.freeze({
    name: "Alpha Split",
    version: "1.3.2",
    testedPhotopea: "5.6",
    scriptingVersion: "30",
    verifiedDate: "2026-07-28",
    verifiedLabel: "28 July 2026",
    requestTimeoutMs: 180000,
    previewMaxSide: 2048,
    repositoryUrl: "https://github.com/chaxic/photopea-alpha-split",
    pluginUrl: "https://chaxic.github.io/photopea-alpha-split/",
    localPort: 4178,
  });
}));
