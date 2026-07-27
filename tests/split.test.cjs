"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../split-core.js");
const meta = require("../meta.js");

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
