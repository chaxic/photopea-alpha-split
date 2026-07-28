(function (root, factory) {
  var data = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = data;
  }

  root.AlphaSplitData = data;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DATA_LAYER_NAME = "AlphaSplit Data";
  var DATA_FILENAME = "alpha-split-data.json";
  var ID_MASK_FILENAME = "alpha-split-id-mask.png";
  var PLUGIN_ID = "alpha-split";

  function padNumber(value, width) {
    var text = String(value);
    while (text.length < width) text = "0" + text;
    return text;
  }

  function serializeLabelColors(labelColors) {
    var out = {};
    if (!labelColors) return out;
    if (typeof labelColors.forEach === "function") {
      labelColors.forEach(function (rgb, id) {
        if (!rgb || rgb.length < 3) return;
        out[String(id)] = [
          Number(rgb[0]) || 0,
          Number(rgb[1]) || 0,
          Number(rgb[2]) || 0,
        ];
      });
      return out;
    }
    Object.keys(labelColors).forEach(function (key) {
      var rgb = labelColors[key];
      if (!rgb || rgb.length < 3) return;
      out[String(key)] = [
        Number(rgb[0]) || 0,
        Number(rgb[1]) || 0,
        Number(rgb[2]) || 0,
      ];
    });
    return out;
  }

  function parseLabelColors(raw) {
    var colors = new Map();
    if (!raw || typeof raw !== "object") return colors;
    Object.keys(raw).forEach(function (key) {
      var id = Number(key);
      if (!Number.isFinite(id) || id < 1) return;
      var rgb = raw[key];
      if (!rgb || rgb.length < 3) return;
      colors.set(id, [
        Number(rgb[0]) || 0,
        Number(rgb[1]) || 0,
        Number(rgb[2]) || 0,
      ]);
    });
    return colors;
  }

  function buildSplitData(options) {
    var settings = options.settings || {};
    var components = options.components || [];
    var meta = options.meta || {};
    var prefix = String(settings.prefix || "element").trim() || "element";
    var exported = options.exported !== false;
    var elements = [];
    var i;

    for (i = 0; i < components.length; i++) {
      var component = components[i];
      var index = i + 1;
      elements.push({
        id: component.id != null ? component.id : index,
        filename: prefix + "_" + padNumber(index, 2) + ".png",
        x: component.minX,
        y: component.minY,
        width: component.maxX - component.minX + 1,
        height: component.maxY - component.minY + 1,
      });
    }

    var payload = {
      version: 1,
      plugin: PLUGIN_ID,
      pluginVersion: String(options.pluginVersion || ""),
      exported: exported,
      settings: {
        alphaThreshold: Number(settings.alphaThreshold) || 8,
        minSize: Number(settings.minSize) || 1,
        prefix: prefix,
        eightConnected: !!settings.eightConnected,
      },
      source: {
        documentName: String(meta.documentName || ""),
        documentSource: String(meta.documentSource || ""),
        layerId: meta.layerId != null ? Number(meta.layerId) : null,
        layerName: String(meta.layerName || ""),
      },
      document: {
        width: Number(options.width || meta.width) || 0,
        height: Number(options.height || meta.height) || 0,
      },
      idMask: ID_MASK_FILENAME,
      elements: elements,
    };
    var colors = serializeLabelColors(options.labelColors);
    if (Object.keys(colors).length) payload.labelColors = colors;
    return payload;
  }

  function validateSplitData(data) {
    if (!data || typeof data !== "object") {
      return { ok: false, message: "Data file is missing or invalid." };
    }
    if (data.plugin && data.plugin !== PLUGIN_ID) {
      return { ok: false, message: "Data file is not an Alpha Split document." };
    }
    if (Number(data.version) !== 1) {
      return { ok: false, message: "Unsupported Alpha Split data version." };
    }
    if (!data.settings || typeof data.settings !== "object") {
      return { ok: false, message: "Data file is missing settings." };
    }
    if (!Array.isArray(data.elements)) {
      return { ok: false, message: "Data file is missing elements." };
    }
    for (var i = 0; i < data.elements.length; i++) {
      var element = data.elements[i];
      if (!element || !element.filename) {
        return { ok: false, message: "Data file has an invalid element entry." };
      }
      // Import names layers from filename; Position needs the full bounding box.
      if (
        !Number.isFinite(Number(element.x)) ||
        !Number.isFinite(Number(element.y))
      ) {
        return { ok: false, message: "Data file has an element without position." };
      }
      if (
        !Number.isFinite(Number(element.width)) ||
        !Number.isFinite(Number(element.height)) ||
        Number(element.width) < 1 ||
        Number(element.height) < 1
      ) {
        return {
          ok: false,
          message: "Data file has an element without a bounding box size.",
        };
      }
    }
    return { ok: true };
  }

  function applySettingsFromData(data) {
    if (!data || !data.settings) return null;
    return {
      alphaThreshold: Number(data.settings.alphaThreshold) || 8,
      minSize: Number(data.settings.minSize) || 1,
      prefix: String(data.settings.prefix || "element").trim() || "element",
      eightConnected: !!data.settings.eightConnected,
    };
  }

  return Object.freeze({
    DATA_LAYER_NAME: DATA_LAYER_NAME,
    DATA_FILENAME: DATA_FILENAME,
    ID_MASK_FILENAME: ID_MASK_FILENAME,
    PLUGIN_ID: PLUGIN_ID,
    buildSplitData: buildSplitData,
    validateSplitData: validateSplitData,
    applySettingsFromData: applySettingsFromData,
    serializeLabelColors: serializeLabelColors,
    parseLabelColors: parseLabelColors,
  });
}));
