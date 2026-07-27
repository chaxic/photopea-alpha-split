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

  function encodeLabelsToImageData(labels, width, height) {
    var data = new Uint8ClampedArray(width * height * 4);
    for (var i = 0; i < labels.length; i++) {
      var id = labels[i] | 0;
      var o = i << 2;
      if (!id) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
        continue;
      }
      data[o] = id & 255;
      data[o + 1] = (id >>> 8) & 255;
      data[o + 2] = (id >>> 16) & 255;
      data[o + 3] = 255;
    }
    if (typeof ImageData !== "undefined") {
      try {
        return new ImageData(data, width, height);
      } catch (_) {}
    }
    return { width: width, height: height, data: data };
  }

  function decodeLabelsFromImageData(imageData) {
    var width = imageData.width;
    var height = imageData.height;
    var src = imageData.data;
    var labels = new Int32Array(width * height);
    for (var i = 0; i < labels.length; i++) {
      var o = i << 2;
      if (src[o + 3] < 128) {
        labels[i] = 0;
        continue;
      }
      labels[i] = src[o] | (src[o + 1] << 8) | (src[o + 2] << 16);
    }
    return labels;
  }

  // Opaque placeholder pixels so the preview paints solid label colours.
  function imageDataFromLabels(labels, width, height) {
    var data = new Uint8ClampedArray(width * height * 4);
    for (var i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      var o = i << 2;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = 255;
    }
    if (typeof ImageData !== "undefined") {
      try {
        return new ImageData(data, width, height);
      } catch (_) {}
    }
    return { width: width, height: height, data: data };
  }

  /**
   * Rebuild an analysis-resolution label map from stored full-res element bboxes.
   * Opaque pixels pick the smallest containing scaled bbox (stable with overlaps).
   */
  function labelsFromElements(
    analysisWidth,
    analysisHeight,
    opaqueMask,
    elements,
    fullWidth,
    fullHeight,
  ) {
    var aw = analysisWidth | 0;
    var ah = analysisHeight | 0;
    var fw = Math.max(1, fullWidth | 0);
    var fh = Math.max(1, fullHeight | 0);
    var labels = new Int32Array(aw * ah);
    if (!elements || !elements.length || !opaqueMask) {
      return { labels: labels, assigned: 0 };
    }

    var boxes = [];
    var i;
    for (i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      var x = Number(el.x) || 0;
      var y = Number(el.y) || 0;
      var w = Math.max(1, Number(el.width) || 1);
      var h = Math.max(1, Number(el.height) || 1);
      var minX = Math.floor((x * aw) / fw);
      var minY = Math.floor((y * ah) / fh);
      var maxX = Math.min(aw - 1, Math.ceil(((x + w) * aw) / fw) - 1);
      var maxY = Math.min(ah - 1, Math.ceil(((y + h) * ah) / fh) - 1);
      if (maxX < minX) maxX = minX;
      if (maxY < minY) maxY = minY;
      var id = el.id != null ? Number(el.id) : i + 1;
      if (!Number.isFinite(id) || id <= 0) id = i + 1;
      boxes.push({
        id: id,
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        area: (maxX - minX + 1) * (maxY - minY + 1),
      });
    }

    boxes.sort(function (a, b) {
      return a.area - b.area || a.id - b.id;
    });

    var assigned = 0;
    var px;
    var py;
    for (py = 0; py < ah; py++) {
      for (px = 0; px < aw; px++) {
        var index = py * aw + px;
        if (!opaqueMask[index]) continue;
        for (i = 0; i < boxes.length; i++) {
          var box = boxes[i];
          if (
            px >= box.minX &&
            px <= box.maxX &&
            py >= box.minY &&
            py <= box.maxY
          ) {
            labels[index] = box.id;
            assigned += 1;
            break;
          }
        }
      }
    }

    return { labels: labels, assigned: assigned };
  }

  function scaleStoredBoxes(elements, analysisWidth, analysisHeight, fullWidth, fullHeight) {
    var aw = analysisWidth | 0;
    var ah = analysisHeight | 0;
    var fw = Math.max(1, fullWidth | 0);
    var fh = Math.max(1, fullHeight | 0);
    var boxes = [];
    if (!elements) return boxes;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      var x = Number(el.x) || 0;
      var y = Number(el.y) || 0;
      var w = Math.max(1, Number(el.width) || 1);
      var h = Math.max(1, Number(el.height) || 1);
      var minX = Math.floor((x * aw) / fw);
      var minY = Math.floor((y * ah) / fh);
      var maxX = Math.min(aw - 1, Math.ceil(((x + w) * aw) / fw) - 1);
      var maxY = Math.min(ah - 1, Math.ceil(((y + h) * ah) / fh) - 1);
      if (maxX < minX) maxX = minX;
      if (maxY < minY) maxY = minY;
      var id = el.id != null ? Number(el.id) : i + 1;
      if (!Number.isFinite(id) || id <= 0) id = i + 1;
      boxes.push({
        id: id,
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        area: (maxX - minX + 1) * (maxY - minY + 1),
        used: false,
      });
    }
    return boxes;
  }

  function boxOverlapArea(a, b) {
    var x0 = Math.max(a.minX, b.minX);
    var y0 = Math.max(a.minY, b.minY);
    var x1 = Math.min(a.maxX, b.maxX);
    var y1 = Math.min(a.maxY, b.maxY);
    if (x1 < x0 || y1 < y0) return 0;
    return (x1 - x0 + 1) * (y1 - y0 + 1);
  }

  /**
   * Remap fresh CCL component ids onto stored element ids by best bbox overlap.
   * Keeps real alpha shapes while restoring previous element identities.
   */
  function matchComponentsToElements(
    labels,
    components,
    elements,
    analysisWidth,
    analysisHeight,
    fullWidth,
    fullHeight,
  ) {
    var boxes = scaleStoredBoxes(
      elements,
      analysisWidth,
      analysisHeight,
      fullWidth,
      fullHeight,
    );
    var remap = new Map();
    var matched = 0;
    var nextNewId = 1;
    var i;
    for (i = 0; i < boxes.length; i++) {
      if (boxes[i].id >= nextNewId) nextNewId = boxes[i].id + 1;
    }

    var sorted = (components || []).slice().sort(function (a, b) {
      return b.size - a.size || a.id - b.id;
    });

    for (i = 0; i < sorted.length; i++) {
      var component = sorted[i];
      var best = null;
      var bestScore = 0;
      var bestCenter = false;
      var cx = (component.minX + component.maxX) / 2;
      var cy = (component.minY + component.maxY) / 2;
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        if (box.used) continue;
        var overlap = boxOverlapArea(component, box);
        if (!overlap) continue;
        var compArea =
          (component.maxX - component.minX + 1) *
          (component.maxY - component.minY + 1);
        var union = compArea + box.area - overlap;
        var iou = union > 0 ? overlap / union : 0;
        var centerInside =
          cx >= box.minX && cx <= box.maxX && cy >= box.minY && cy <= box.maxY;
        var score = iou * 1000 + overlap;
        if (centerInside) score += 500;
        if (
          score > bestScore ||
          (score === bestScore && centerInside && !bestCenter)
        ) {
          best = box;
          bestScore = score;
          bestCenter = centerInside;
        }
      }
      if (best && (bestCenter || bestScore > 0)) {
        best.used = true;
        remap.set(component.id, best.id);
        matched += 1;
      } else {
        remap.set(component.id, nextNewId++);
      }
    }

    var outLabels = new Int32Array(labels.length);
    for (i = 0; i < labels.length; i++) {
      var oldId = labels[i];
      if (!oldId) continue;
      outLabels[i] = remap.has(oldId) ? remap.get(oldId) : oldId;
    }

    var outComponents = buildComponentsFromLabels(
      outLabels,
      analysisWidth,
      analysisHeight,
      1,
    );
    return {
      labels: outLabels,
      components: outComponents,
      matched: matched,
    };
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
    labelsFromElements: labelsFromElements,
    matchComponentsToElements: matchComponentsToElements,
    createDefaultPalette: createDefaultPalette,
    createRandomPalette: createRandomPalette,
    collectLabelIds: collectLabelIds,
    encodeLabelsToImageData: encodeLabelsToImageData,
    decodeLabelsFromImageData: decodeLabelsFromImageData,
    imageDataFromLabels: imageDataFromLabels,
  };
}));
