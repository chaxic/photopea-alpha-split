"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../split-core.js");
const meta = require("../meta.js");
const zip = require("../zip-util.js");
const data = require("../data-util.js");

function makeImageData(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const offset = (y * width + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

test("detects three separate opaque regions", () => {
  const image = makeImageData(40, 40, [
    [2, 2, 8, 8],
    [20, 5, 28, 12],
    [5, 25, 15, 35],
  ]);
  const labeled = core.labelComponents(image, 8, 4, true);
  assert.equal(labeled.components.length, 3);
});

test("4-connected vs 8-connected diagonal touch", () => {
  const image = makeImageData(10, 10, [
    [1, 1, 2, 2],
    [3, 3, 4, 4],
  ]);
  assert.equal(core.labelComponents(image, 8, 1, false).components.length, 2);
  assert.equal(core.labelComponents(image, 8, 1, true).components.length, 1);
});

test("filters noise below minSize", () => {
  const image = makeImageData(20, 20, [
    [1, 1, 10, 10],
    [15, 15, 15, 15],
  ]);
  assert.equal(core.labelComponents(image, 8, 5, true).components.length, 1);
});

test("attached shadow stays one element", () => {
  const image = makeImageData(30, 20, [[5, 5, 14, 14]]);
  for (let y = 8; y <= 14; y++) {
    for (let x = 15; x <= 18; x++) {
      const offset = (y * 30 + x) * 4;
      image.data[offset + 3] = 255;
    }
  }
  assert.equal(core.labelComponents(image, 8, 4, true).components.length, 1);
});

test("extractComponentCrop keeps only the bbox and origin", () => {
  const image = makeImageData(20, 20, [
    [2, 3, 5, 6],
    [12, 12, 14, 14],
  ]);
  const labeled = core.labelComponents(image, 8, 1, true);
  const first = labeled.components[0];
  const crop = core.extractComponentCrop(image, labeled.labels, first);
  assert.equal(crop.x, first.minX);
  assert.equal(crop.y, first.minY);
  assert.equal(crop.width, first.maxX - first.minX + 1);
  assert.equal(crop.height, first.maxY - first.minY + 1);
  assert.equal(crop.imageData.width, crop.width);
  assert.equal(crop.imageData.height, crop.height);
  let opaque = 0;
  for (let i = 3; i < crop.imageData.data.length; i += 4) {
    if (crop.imageData.data[i] > 0) opaque += 1;
  }
  assert.equal(opaque, first.size);
});

test("validateSettings rejects bad thresholds", () => {
  assert.equal(core.validateSettings({ alphaThreshold: 0, minSize: 1, prefix: "e" }).ok, false);
  assert.equal(core.validateSettings({ alphaThreshold: 8, minSize: 0, prefix: "e" }).ok, false);
  assert.equal(core.validateSettings({ alphaThreshold: 8, minSize: 1, prefix: "  " }).ok, false);
  assert.equal(core.validateSettings({ alphaThreshold: 8, minSize: 1, prefix: "element" }).ok, true);
});

test("plugin JSON URLs use HTTPS Pages host and === icon prefix", () => {
  for (const fileName of ["plugin.json", "alpha-split-photopea.json"]) {
    const json = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", fileName), "utf8"),
    );
    assert.equal(json.name, meta.name);
    assert.match(json.url, /^https:\/\/chaxic\.github\.io\/photopea-alpha-split\/\?v=/);
    assert.match(json.icon, /^===https:\/\/chaxic\.github\.io\/photopea-alpha-split\/assets\/icon\.svg/);
    assert.match(json.url, new RegExp(`v=${meta.version.replaceAll(".", "\\.")}`));
  }
});

test("local plugin JSON uses === icon prefix", () => {
  const json = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "plugin.local.json"), "utf8"),
  );
  assert.match(json.url, /^http:\/\/127\.0\.0\.1:4178\/?/);
  assert.match(json.icon, /^===http:\/\/127\.0\.0\.1:4178\/assets\/icon\.svg/);
});

test("version is consistent across package and meta", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  assert.equal(pkg.version, meta.version);
  assert.equal(meta.pluginUrl, "https://chaxic.github.io/photopea-alpha-split/");
});

test("stored ZIP starts with a local file header", async () => {
  const payload = new TextEncoder().encode("hello");
  const blob = zip.createStoredZip([{ name: "hello.txt", data: payload }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  assert.ok(bytes.length > 30 + "hello.txt".length + payload.length);
});

test("installer page loads zip-util and export wording", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /zip-util\.js\?v=/);
  assert.match(html, /data-util\.js\?v=/);
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const dataUtil = fs.readFileSync(path.join(__dirname, "..", "data-util.js"), "utf8");
  assert.match(app, /Export elements/);
  assert.match(app, /Import Elements/);
  assert.match(app, /Position Elements/);
  assert.match(app, /DATA\.DATA_FILENAME|alpha-split-data\.json/);
  assert.match(dataUtil, /AlphaSplit Data/);
  assert.match(dataUtil, /alpha-split-data\.json/);
  assert.doesNotMatch(app, /Split into layers/);
  assert.doesNotMatch(app, /makePlaceLayerScript/);
  assert.match(app, /Randomize colors/);
  assert.match(app, /labelsEdited/);
  assert.match(app, /propagateLabelsToFullRes/);
});

test("data-layer traffic never occupies the blocking request slot", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /sendDataLayerScript/);
  assert.match(app, /dataLayerWaits/);
  // setWorking disables the panel and starts the stuck-request timer.
  assert.doesNotMatch(app, /setWorking\(\s*"reading data"/);
  assert.doesNotMatch(app, /setWorking\(\s*"saving data"/);
  // The restore read must be deferred, not fired during panel construction.
  assert.match(app, /restoreSavedSettings/);
  assert.doesNotMatch(app, /await requestDataLayerRead\(\);\s*\n\s*if \(layerData\)/);
});

test("Import and Position are separate operations", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /makeImportEnsureGroupScript/);
  assert.match(app, /makeImportOpenScript/);
  assert.match(app, /makeImportCaptureScript/);
  assert.match(app, /makePositionByNameScript/);
  assert.match(app, /beginImportElements/);
  assert.match(app, /beginPositionElements/);
  assert.match(app, /data-run="import-elements"/);
  assert.match(app, /data-run="position-elements"/);
  // The combined Assemble action and its id-keyed batch step are gone.
  assert.doesNotMatch(app, /beginAssemble/);
  assert.doesNotMatch(app, /makeAssembleBatchFinishScript/);
  assert.doesNotMatch(app, /data-run="assemble"/);
  // Import claims the new "image" layer and must verify the rename.
  assert.match(app, /knownLayerIds/);
  assert.match(app, /name === "image"/);
  assert.match(app, /renamed = String\(resultLayer\.name\) === expected/);
  assert.match(app, /awaitingOpenDone/);
  assert.match(app, /matchComponentsToElements|CORE\.matchComponentsToElements/);
  // Placing a Smart Object leaves Free Transform open; commit before rename.
  assert.match(app, /commitActiveTransform/);
  assert.match(app, /stringIDToTypeID\("commit"\)/);
});

// Photopea runs these strings, so a syntax error there is invisible to the panel:
// the script never replies and the operation hangs instead of failing.
function generatedPhotopeaScripts(app) {
  const helpersStart = app.indexOf("function commonHelpers() {");
  const helpersOpen = app.indexOf("return `", helpersStart) + "return `".length;
  const helpers = app.slice(helpersOpen, app.indexOf("`;", helpersOpen));

  const opener = "  return `\n(function () {";
  const closer = "\n}());`;";
  return app
    .split(opener)
    .slice(1)
    .map((chunk) => {
      const body = "(function () {" + chunk.slice(0, chunk.indexOf(closer)) + "\n}());";
      return body
        .replaceAll("${commonHelpers()}", helpers)
        .replace(/\$\{[^}]*\}/g, "null");
    });
}

test("every generated Photopea script parses", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const scripts = generatedPhotopeaScripts(app);
  assert.ok(scripts.length >= 10, `expected many scripts, found ${scripts.length}`);
  for (const script of scripts) {
    assert.doesNotThrow(
      () => new Function(script),
      `generated script does not parse:\n${script.slice(0, 400)}`,
    );
  }
});

test("import can only claim layers it placed", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  // Every pre-existing layer is baselined before the first PNG is placed.
  assert.match(app, /collectLayerIds\(documentRef, \[\]\)/);
  assert.match(app, /state\._importJob\.knownLayerIds = Array\.isArray\(payload\.knownLayerIds\)/);
  // Claiming is name-gated and never touches text layers or the data layer.
  assert.match(app, /function isCandidate/);
  assert.match(app, /function isNamedForPlacement/);
  assert.match(app, /if \(isTextLayer\(layer\)\) return false/);
  assert.match(app, /String\(layer\.name\) !== settings\.dataLayerName/);
  // The blind "first unknown layer wins" fallback renamed user artwork.
  assert.doesNotMatch(app, /findNewestUnknownArtLayer/);
  // A stalled step fails in seconds and reports what Photopea actually created.
  assert.match(app, /IMPORT_STEP_TIMEOUT_MS/);
  assert.match(app, /unknownNames/);
});

test("layers move into groups without the illegal INSIDE placement", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  // ElementPlacement.INSIDE throws Illegal Argument for LayerSet targets and can
  // abort the whole script (try/catch does not always catch it), so never call it.
  assert.match(app, /layer\.move\(anchor, ElementPlacement\.PLACEBEFORE\)/);
  assert.match(app, /layer\.move\(temporary, ElementPlacement\.PLACEBEFORE\)/);
  assert.doesNotMatch(app, /move\([^,]+,\s*(?:ElementPlacement\.INSIDE|inside)\)/);
  assert.doesNotMatch(app, /layer\.move\(group,/);
  // Success is confirmed by membership, not by "the call did not throw".
  assert.match(app, /if \(isInsideGroup\(layer, group\)\) return true/);
});

test("the data layer survives being renamed", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /function findDataLayerByText/);
  assert.match(app, /findDataLayer\(documentRef, settings\.layerName\)/);
  assert.doesNotMatch(app, /findArtLayerByName\(documentRef, settings\.layerName\)/);
});

test("Position matches layers by name and uses stored bbox origins", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  // Text layers can share an element name, so only pixel layers are positioned.
  assert.match(app, /findPlacedLayerByName\(documentRef, item\.name\)/);
  assert.match(app, /function findPlacedLayerByName/);
  assert.match(app, /item\.x - px\(bounds\[0\]\)/);
  assert.match(app, /item\.y - px\(bounds\[1\]\)/);
  assert.match(app, /elementLayerName/);
  assert.match(app, /position-done/);
  // Position must not depend on ids recorded during import.
  assert.doesNotMatch(app, /findLayerById\(documentRef, item\.layerId\)/);
});

test("Restore ID Mask skips the PSD snapshot round trip", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /makeLightCaptureScript/);
  // Restore exports the isolated layer straight from the workfile...
  assert.match(app, /restoreMode\s*\n?\s*\?\s*makeLightCaptureScript/);
  // ...and puts the layer visibility back afterwards.
  assert.match(app, /collectVisibility/);
  assert.match(app, /restoreVisibility/);
  // Generate keeps the workfile-safe PSD snapshot.
  assert.match(app, /saveToOE\("psd"\)/);
  assert.match(app, /exporting the layer/);
});

test("Generate and Restore ID Mask replace Preview", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /Generate ID Mask/);
  assert.match(app, /Restore ID Mask/);
  assert.match(app, /generate-mask/);
  assert.match(app, /restore-mask/);
  assert.match(app, /buildSchematicScan/);
  assert.match(app, /applyLoadedSplitData/);
  assert.match(app, /loadDataLayerFromSelection/);
  assert.match(app, /loadDataFileFromFolderOrPicker/);
  assert.match(app, /scanMode === "restore"/);
  assert.doesNotMatch(app, /data-run="scan"/);
});

test("JSON data file picker posts ALPHA_SPLIT_JSON_READY", () => {
  const picker = fs.readFileSync(path.join(__dirname, "..", "picker.js"), "utf8");
  assert.match(picker, /ALPHA_SPLIT_JSON_READY/);
  assert.match(picker, /showOpenFilePicker/);
  assert.match(picker, /mode === "json"/);
});

test("labelsFromElements paints opaque pixels from full-res bboxes", () => {
  const opaque = new Uint8Array(8 * 8);
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x <= 2; x++) opaque[y * 8 + x] = 1;
  }
  for (let y = 5; y <= 6; y++) {
    for (let x = 5; x <= 6; x++) opaque[y * 8 + x] = 1;
  }
  // Full-res document 16x16; analysis 8x8 → half scale.
  const painted = core.labelsFromElements(
    8,
    8,
    opaque,
    [
      { id: 3, x: 2, y: 2, width: 4, height: 4 },
      { id: 7, x: 10, y: 10, width: 4, height: 4 },
    ],
    16,
    16,
  );
  assert.ok(painted.assigned >= 4);
  assert.equal(painted.labels[1 * 8 + 1], 3);
  assert.equal(painted.labels[5 * 8 + 5], 7);
  const components = core.buildComponentsFromLabels(painted.labels, 8, 8, 1);
  assert.equal(components.length, 2);
});

test("labelsFromElements prefers the smaller overlapping bbox", () => {
  const opaque = new Uint8Array(4 * 4).fill(1);
  const painted = core.labelsFromElements(
    4,
    4,
    opaque,
    [
      { id: 1, x: 0, y: 0, width: 4, height: 4 },
      { id: 2, x: 1, y: 1, width: 1, height: 1 },
    ],
    4,
    4,
  );
  assert.equal(painted.labels[1 * 4 + 1], 2);
  assert.equal(painted.labels[0], 1);
});

test("matchComponentsToElements remaps CCL ids to stored boxes", () => {
  const labels = new Int32Array(8 * 8);
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x <= 2; x++) labels[y * 8 + x] = 1;
  }
  for (let y = 5; y <= 6; y++) {
    for (let x = 5; x <= 6; x++) labels[y * 8 + x] = 2;
  }
  const components = core.buildComponentsFromLabels(labels, 8, 8, 1);
  const matched = core.matchComponentsToElements(
    labels,
    components,
    [
      { id: 10, x: 2, y: 2, width: 4, height: 4 },
      { id: 20, x: 10, y: 10, width: 4, height: 4 },
    ],
    8,
    8,
    16,
    16,
  );
  assert.equal(matched.matched, 2);
  assert.equal(matched.labels[1 * 8 + 1], 10);
  assert.equal(matched.labels[5 * 8 + 5], 20);
  // Shapes stay non-rectangular: only the opaque CCL pixels are labeled.
  assert.equal(matched.labels[1 * 8 + 3], 0);
});

test("ID mask PNG round-trips label ids above 255", () => {
  const labels = new Int32Array(4 * 4);
  labels[0] = 1;
  labels[5] = 300;
  labels[10] = 65540;
  const encoded = core.encodeLabelsToImageData(labels, 4, 4);
  const decoded = core.decodeLabelsFromImageData(encoded);
  assert.equal(decoded[0], 1);
  assert.equal(decoded[5], 300);
  assert.equal(decoded[10], 65540);
  assert.equal(decoded[1], 0);
});

test("Export writes ID mask and Restore prefers the folder file", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const dataUtil = fs.readFileSync(path.join(__dirname, "..", "data-util.js"), "utf8");
  assert.match(dataUtil, /ID_MASK_FILENAME/);
  assert.match(dataUtil, /alpha-split-id-mask\.png/);
  assert.match(app, /writeIdMaskFile/);
  assert.match(app, /restoreIdMaskFromFolder/);
  assert.match(app, /buildScanFromIdMaskLabels/);
  assert.match(app, /continueExportWithArtwork/);
  assert.match(app, /encodeLabelsToImageData/);
  assert.match(app, /decodeLabelsFromImageData/);
});

test("buildSplitData creates sequential filenames and bboxes", () => {
  const built = data.buildSplitData({
    settings: {
      alphaThreshold: 8,
      minSize: 32,
      prefix: "element",
      eightConnected: true,
    },
    components: [
      { id: 3, minX: 10, minY: 20, maxX: 19, maxY: 29 },
      { id: 7, minX: 40, minY: 50, maxX: 45, maxY: 55 },
    ],
    meta: { documentName: "sheet.psd", layerId: 9, layerName: "Sheet" },
    width: 100,
    height: 200,
    pluginVersion: "1.3.0",
    exported: true,
  });
  assert.equal(built.version, 1);
  assert.equal(built.plugin, "alpha-split");
  assert.equal(built.elements.length, 2);
  assert.equal(built.elements[0].filename, "element_01.png");
  assert.equal(built.elements[0].x, 10);
  assert.equal(built.elements[0].width, 10);
  assert.equal(built.elements[1].filename, "element_02.png");
  assert.equal(data.validateSplitData(built).ok, true);
});

test("validateSplitData rejects bad payloads", () => {
  assert.equal(data.validateSplitData(null).ok, false);
  assert.equal(data.validateSplitData({ version: 2, plugin: "alpha-split" }).ok, false);
  assert.equal(
    data.validateSplitData({
      version: 1,
      plugin: "alpha-split",
      settings: {},
      elements: [{ filename: "a.png" }],
    }).ok,
    false,
  );
});

test("validateSplitData requires a full bounding box per element", () => {
  const base = {
    version: 1,
    plugin: "alpha-split",
    settings: { prefix: "element" },
  };
  assert.equal(
    data.validateSplitData({
      ...base,
      elements: [{ filename: "a.png", x: 1, y: 2, width: 3, height: 4 }],
    }).ok,
    true,
  );
  assert.equal(
    data.validateSplitData({
      ...base,
      elements: [{ filename: "a.png", x: 1, y: 2 }],
    }).ok,
    false,
  );
  assert.equal(
    data.validateSplitData({
      ...base,
      elements: [{ filename: "a.png", x: 1, y: 2, width: 0, height: 4 }],
    }).ok,
    false,
  );
});

test("floodIsland respects 4 vs 8 connectivity", () => {
  const labels = new Int32Array(5 * 5);
  labels[1 * 5 + 1] = 1;
  labels[2 * 5 + 2] = 1;
  const four = core.floodIsland(labels, 5, 5, 1, 1, false);
  assert.equal(four.size, 1);
  const eight = core.floodIsland(labels, 5, 5, 1, 1, true);
  assert.equal(eight.size, 2);
});

test("fill join merges two labels into one component", () => {
  const labels = new Int32Array(10 * 10);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) labels[y * 10 + x] = 1;
  }
  for (let y = 5; y <= 7; y++) {
    for (let x = 5; x <= 7; x++) labels[y * 10 + x] = 2;
  }
  const island = core.floodIsland(labels, 10, 10, 5, 5, true);
  core.relabelIsland(labels, island.mask, 1);
  const components = core.buildComponentsFromLabels(labels, 10, 10, 1);
  assert.equal(components.length, 1);
  assert.equal(components[0].id, 1);
  assert.equal(components[0].size, 18);
});

test("fill separate splits an 8-connected pair", () => {
  const labels = new Int32Array(10 * 10);
  labels[1 * 10 + 1] = 1;
  labels[1 * 10 + 2] = 1;
  labels[2 * 10 + 2] = 1;
  labels[3 * 10 + 3] = 1;
  labels[3 * 10 + 4] = 1;
  // With 4-connected flood, the diagonal-only touch at (2,2)-(3,3) separates.
  const island = core.floodIsland(labels, 10, 10, 3, 3, false);
  const newId = core.nextLabelId(labels);
  core.relabelIsland(labels, island.mask, newId);
  const components = core.buildComponentsFromLabels(labels, 10, 10, 1);
  assert.equal(components.length, 2);
});

test("buildComponentsFromLabels respects minSize", () => {
  const labels = new Int32Array(8 * 8);
  for (let i = 0; i < 10; i++) labels[i] = 1;
  labels[20] = 2;
  const components = core.buildComponentsFromLabels(labels, 8, 8, 5);
  assert.equal(components.length, 1);
  assert.equal(components[0].id, 1);
});

test("propagateLabelsToFullRes maps 2x2 analysis onto 4x4", () => {
  const analysis = new Int32Array([1, 2, 3, 4]);
  const opaque = new Uint8Array(16).fill(1);
  const full = core.propagateLabelsToFullRes(analysis, 2, 2, 4, 4, opaque);
  assert.equal(full[0], 1);
  assert.equal(full[1], 1);
  assert.equal(full[2], 2);
  assert.equal(full[3], 2);
  assert.equal(full[4], 1);
  assert.equal(full[8], 3);
  assert.equal(full[10], 4);
  assert.equal(full[15], 4);
});

test("createRandomPalette returns a colour for each label id", () => {
  const palette = core.createRandomPalette([1, 3, 5]);
  assert.equal(palette.size, 3);
  assert.ok(Array.isArray(palette.get(1)));
  assert.equal(palette.get(1).length, 3);
});
