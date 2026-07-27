"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../split-core.js");
const meta = require("../meta.js");
const zip = require("../zip-util.js");

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
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /Export elements/);
  assert.doesNotMatch(app, /Split into layers/);
  assert.doesNotMatch(app, /makePlaceLayerScript/);
});
