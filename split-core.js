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

  function extractComponent(imageData, labels, componentId) {
    var out = new ImageData(imageData.width, imageData.height);
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

  return {
    labelComponents: labelComponents,
    extractComponent: extractComponent,
    validateSettings: validateSettings,
  };
}));
