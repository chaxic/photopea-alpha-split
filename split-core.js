(function (root, factory) {
  var core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }

  root.AlphaSplitCore = core;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function labelComponents(imageData, alphaThreshold, minSize, eightConnected) {
    var width = imageData.width;
    var height = imageData.height;
    var data = imageData.data;
    var n = width * height;
    var parent = new Int32Array(n);
    var opaque = new Uint8Array(n);
    var i;

    for (i = 0; i < n; i++) {
      opaque[i] = data[(i << 2) + 3] >= alphaThreshold ? 1 : 0;
      parent[i] = i;
    }

    function find(a) {
      var r = a;
      while (parent[r] !== r) r = parent[r];
      while (parent[a] !== a) {
        var next = parent[a];
        parent[a] = r;
        a = next;
      }
      return r;
    }

    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }

    var x;
    var y;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        if (!opaque[i]) continue;
        if (x + 1 < width && opaque[i + 1]) union(i, i + 1);
        if (y + 1 < height && opaque[i + width]) union(i, i + width);
        if (eightConnected) {
          if (x + 1 < width && y + 1 < height && opaque[i + width + 1]) {
            union(i, i + width + 1);
          }
          if (x > 0 && y + 1 < height && opaque[i + width - 1]) {
            union(i, i + width - 1);
          }
        }
      }
    }

    var rootSize = new Map();
    var rootBounds = new Map();

    for (i = 0; i < n; i++) {
      if (!opaque[i]) continue;
      var root = find(i);
      rootSize.set(root, (rootSize.get(root) || 0) + 1);
      x = i % width;
      y = (i / width) | 0;
      var bounds = rootBounds.get(root);
      if (!bounds) {
        rootBounds.set(root, { minX: x, minY: y, maxX: x, maxY: y });
      } else {
        if (x < bounds.minX) bounds.minX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }

    var keep = new Map();
    var nextId = 1;
    var components = [];

    rootSize.forEach(function (size, rootKey) {
      if (size < minSize) return;
      var id = nextId++;
      keep.set(rootKey, id);
      var b = rootBounds.get(rootKey);
      components.push({
        id: id,
        size: size,
        minX: b.minX,
        minY: b.minY,
        maxX: b.maxX,
        maxY: b.maxY,
      });
    });

    components.sort(function (a, b) {
      return a.minY - b.minY || a.minX - b.minX;
    });

    var remap = new Map();
    components.forEach(function (component, index) {
      remap.set(component.id, index + 1);
      component.id = index + 1;
    });

    var labels = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (!opaque[i]) continue;
      var kept = keep.get(find(i));
      if (kept) labels[i] = remap.get(kept);
    }

    return {
      labels: labels,
      components: components,
      width: width,
      height: height,
    };
  }

  function createImageData(width, height) {
    if (typeof ImageData === "function") {
      return new ImageData(width, height);
    }
    return {
      width: width,
      height: height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  function extractComponent(imageData, labels, componentId) {
    var out = createImageData(imageData.width, imageData.height);
    var src = imageData.data;
    var dst = out.data;
    var i;
    for (i = 0; i < labels.length; i++) {
      if (labels[i] !== componentId) continue;
      var offset = i << 2;
      dst[offset] = src[offset];
      dst[offset + 1] = src[offset + 1];
      dst[offset + 2] = src[offset + 2];
      dst[offset + 3] = src[offset + 3];
    }
    return out;
  }

  /**
   * Extract only the component's bounding box — much faster for large documents.
   * Returns { imageData, x, y, width, height }.
   */
  function extractComponentCrop(imageData, labels, component) {
    var fullWidth = imageData.width;
    var src = imageData.data;
    var x0 = component.minX;
    var y0 = component.minY;
    var width = component.maxX - component.minX + 1;
    var height = component.maxY - component.minY + 1;
    var out = createImageData(width, height);
    var dst = out.data;
    var y;
    var x;

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        var srcIndex = (y0 + y) * fullWidth + (x0 + x);
        if (labels[srcIndex] !== component.id) continue;
        var srcOffset = srcIndex << 2;
        var dstOffset = (y * width + x) << 2;
        dst[dstOffset] = src[srcOffset];
        dst[dstOffset + 1] = src[srcOffset + 1];
        dst[dstOffset + 2] = src[srcOffset + 2];
        dst[dstOffset + 3] = src[srcOffset + 3];
      }
    }

    return {
      imageData: out,
      x: x0,
      y: y0,
      width: width,
      height: height,
    };
  }

  function validateSettings(settings) {
    var alpha = Number(settings.alphaThreshold);
    var minSize = Number(settings.minSize);
    if (!Number.isFinite(alpha) || alpha < 1 || alpha > 255) {
      return { ok: false, message: "Alpha threshold must be between 1 and 255." };
    }
    if (!Number.isFinite(minSize) || minSize < 1) {
      return { ok: false, message: "Minimum pixels must be at least 1." };
    }
    if (!String(settings.prefix || "").trim()) {
      return { ok: false, message: "Enter a layer name prefix." };
    }
    return { ok: true };
  }

  /**
   * Rebuild component metadata from an existing label map.
   * Keeps stable label IDs so display colours stay consistent.
   */
  function buildComponentsFromLabels(labels, width, height, minSize) {
    var n = width * height;
    var sizes = new Map();
    var bounds = new Map();
    var i;
    var x;
    var y;
    var id;

    for (i = 0; i < n; i++) {
      id = labels[i];
      if (!id) continue;
      sizes.set(id, (sizes.get(id) || 0) + 1);
      x = i % width;
      y = (i / width) | 0;
      var b = bounds.get(id);
      if (!b) {
        bounds.set(id, { minX: x, minY: y, maxX: x, maxY: y });
      } else {
        if (x < b.minX) b.minX = x;
        if (y < b.minY) b.minY = y;
        if (x > b.maxX) b.maxX = x;
        if (y > b.maxY) b.maxY = y;
      }
    }

    var components = [];
    sizes.forEach(function (size, labelId) {
      if (size < minSize) return;
      var box = bounds.get(labelId);
      components.push({
        id: labelId,
        size: size,
        minX: box.minX,
        minY: box.minY,
        maxX: box.maxX,
        maxY: box.maxY,
      });
    });

    components.sort(function (a, b) {
      return a.minY - b.minY || a.minX - b.minX || a.id - b.id;
    });

    return components;
  }

  /**
   * Flood-fill contiguous pixels that share the seed label.
   * Returns a Uint8Array mask (1 = in island) and the seed label id.
   */
  function floodIsland(labels, width, height, x, y, eightConnected) {
    var n = width * height;
    var mask = new Uint8Array(n);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return { mask: mask, label: 0, size: 0 };
    }
    var start = y * width + x;
    var seed = labels[start];
    if (!seed) {
      return { mask: mask, label: 0, size: 0 };
    }

    var stack = [start];
    var size = 0;
    mask[start] = 1;

    while (stack.length) {
      var i = stack.pop();
      size += 1;
      var cx = i % width;
      var cy = (i / width) | 0;
      var neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      if (eightConnected) {
        neighbors.push(
          [cx + 1, cy + 1],
          [cx - 1, cy + 1],
          [cx + 1, cy - 1],
          [cx - 1, cy - 1],
        );
      }
      for (var nIdx = 0; nIdx < neighbors.length; nIdx++) {
        var nx = neighbors[nIdx][0];
        var ny = neighbors[nIdx][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        var ni = ny * width + nx;
        if (mask[ni]) continue;
        if (labels[ni] !== seed) continue;
        mask[ni] = 1;
        stack.push(ni);
      }
    }

    return { mask: mask, label: seed, size: size };
  }

  function relabelIsland(labels, islandMask, targetLabel) {
    var changed = 0;
    for (var i = 0; i < islandMask.length; i++) {
      if (!islandMask[i]) continue;
      labels[i] = targetLabel;
      changed += 1;
    }
    return changed;
  }

  function nextLabelId(labels) {
    var max = 0;
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] > max) max = labels[i];
    }
    return max + 1;
  }

  /**
   * Map analysis-resolution labels onto a full-resolution opaque mask.
   * opaqueMask may be Uint8Array (1 = opaque) or derived from ImageData alpha.
   */
  function propagateLabelsToFullRes(
    analysisLabels,
    analysisW,
    analysisH,
    fullW,
    fullH,
    opaqueMask,
  ) {
    var full = new Int32Array(fullW * fullH);
    var fx;
    var fy;
    for (fy = 0; fy < fullH; fy++) {
      var ay = Math.min(
        analysisH - 1,
        Math.floor((fy * analysisH) / fullH),
      );
      for (fx = 0; fx < fullW; fx++) {
        var fi = fy * fullW + fx;
        if (!opaqueMask[fi]) continue;
        var ax = Math.min(
          analysisW - 1,
          Math.floor((fx * analysisW) / fullW),
        );
        full[fi] = analysisLabels[ay * analysisW + ax];
      }
    }
    return full;
  }

  function buildOpaqueMaskFromImageData(imageData, alphaThreshold) {
    var n = imageData.width * imageData.height;
    var mask = new Uint8Array(n);
    var data = imageData.data;
    for (var i = 0; i < n; i++) {
      mask[i] = data[(i << 2) + 3] >= alphaThreshold ? 1 : 0;
    }
    return mask;
  }

  function hslToRgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r1 = 0;
    var g1 = 0;
    var b1 = 0;
    if (hp >= 0 && hp < 1) {
      r1 = c;
      g1 = x;
    } else if (hp < 2) {
      r1 = x;
      g1 = c;
    } else if (hp < 3) {
      g1 = c;
      b1 = x;
    } else if (hp < 4) {
      g1 = x;
      b1 = c;
    } else if (hp < 5) {
      r1 = x;
      b1 = c;
    } else {
      r1 = c;
      b1 = x;
    }
    var m = l - c / 2;
    return [
      Math.round((r1 + m) * 255),
      Math.round((g1 + m) * 255),
      Math.round((b1 + m) * 255),
    ];
  }

  var DEFAULT_PALETTE = [
    [76, 139, 245],
    [90, 158, 111],
    [208, 181, 106],
    [196, 92, 92],
    [168, 120, 200],
    [80, 180, 180],
    [220, 140, 80],
    [140, 160, 220],
  ];

  function createDefaultPalette(labelIds) {
    var colors = new Map();
    var ids = labelIds.slice().sort(function (a, b) {
      return a - b;
    });
    for (var i = 0; i < ids.length; i++) {
      colors.set(ids[i], DEFAULT_PALETTE[i % DEFAULT_PALETTE.length].slice());
    }
    return colors;
  }

  function createRandomPalette(labelIds) {
    var colors = new Map();
    var ids = labelIds.slice().sort(function (a, b) {
      return a - b;
    });
    var count = Math.max(1, ids.length);
    var hueOffset = Math.random() * 360;
    for (var i = 0; i < ids.length; i++) {
      var hue = (hueOffset + (i * 360) / count) % 360;
      var sat = 0.55 + (i % 3) * 0.1;
      var light = 0.48 + ((i % 2) * 0.08);
      colors.set(ids[i], hslToRgb(hue, sat, light));
    }
    return colors;
  }

  function collectLabelIds(labels) {
    var seen = new Set();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i]) seen.add(labels[i]);
    }
    return Array.from(seen);
  }

  return {
    labelComponents: labelComponents,
    extractComponent: extractComponent,
    extractComponentCrop: extractComponentCrop,
    validateSettings: validateSettings,
    buildComponentsFromLabels: buildComponentsFromLabels,
    floodIsland: floodIsland,
    relabelIsland: relabelIsland,
    nextLabelId: nextLabelId,
    propagateLabelsToFullRes: propagateLabelsToFullRes,
    buildOpaqueMaskFromImageData: buildOpaqueMaskFromImageData,
    createDefaultPalette: createDefaultPalette,
    createRandomPalette: createRandomPalette,
    collectLabelIds: collectLabelIds,
  };
}));
