"use strict";

const META = window.ALPHA_SPLIT_META;
const CORE = window.AlphaSplitCore;
const RESULT_PREFIX = "ALPHA_SPLIT_RESULT::";
const MESSAGE_PREFIX = "ALPHA_SPLIT::";

if (!META || !CORE) {
  const root = document.querySelector("#app");
  if (root) {
    root.textContent =
      "Alpha Split could not load its required files. Refresh the panel.";
  }
  throw new Error("Alpha Split dependencies are unavailable.");
}

const state = {
  embedded: window.parent !== window,
  alphaThreshold: 8,
  minSize: 32,
  prefix: "element",
  eightConnected: true,
  hideSource: true,
  groupLayers: true,
  stage: "idle",
  statusKind: "idle",
  statusText: "",
  scan: null,
  activeRequestId: null,
  activeOperation: null,
  requestTimer: null,
  pendingBinary: null,
  pendingDone: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluginBaseUrl() {
  return new URL("./", document.baseURI).href;
}

function versionedUrl(relativePath) {
  const url = new URL(relativePath, pluginBaseUrl());
  url.searchParams.set("v", META.version);
  return url.href;
}

function createRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function padNumber(value, width) {
  return String(value).padStart(Math.max(1, width), "0");
}

function statusIcon() {
  if (state.statusKind === "working") {
    return '<span class="spinner" aria-hidden="true"></span>';
  }

  const path =
    state.statusKind === "ok"
      ? "m5 10.2 3.1 3.1L15.4 6"
      : state.statusKind === "error"
        ? "M10 5.4v5.4M10 14.5v.1"
        : "M4.8 6.2h10.4M4.8 10h7.6M4.8 13.8h5.2";

  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"></path></svg>`;
}

function settingsFromState() {
  return {
    alphaThreshold: Number(state.alphaThreshold) || 8,
    minSize: Number(state.minSize) || 1,
    prefix: String(state.prefix || "element").trim() || "element",
    eightConnected: !!state.eightConnected,
    hideSource: !!state.hideSource,
    groupLayers: !!state.groupLayers,
  };
}

function panelHtml() {
  const busy = state.statusKind === "working";
  const disabled = busy ? " disabled" : "";
  const canSplit = !busy && state.scan && state.scan.components.length > 0;
  const splitDisabled = canSplit ? "" : " disabled";
  const count = state.scan ? state.scan.components.length : 0;

  return `
    <section class="plugin-panel" aria-label="Alpha Split plugin">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true">α</div>
        <div class="panel-heading">
          <div class="panel-title-row">
            <h1>${escapeHtml(META.name)}</h1>
            <span class="version-badge">v${escapeHtml(META.version)}</span>
          </div>
          <p>Split by alpha regions</p>
        </div>
      </header>

      <div class="panel-body">
        <div class="field-grid">
          <label>
            <span>Alpha threshold</span>
            <input id="alpha" type="number" min="1" max="255" value="${state.alphaThreshold}"${disabled} />
          </label>
          <label>
            <span>Min pixels</span>
            <input id="min-size" type="number" min="1" value="${state.minSize}"${disabled} />
          </label>
        </div>

        <label class="stacked-field">
          <span>Layer name prefix</span>
          <input id="prefix" value="${escapeHtml(state.prefix)}" placeholder="element"${disabled} />
        </label>

        <div class="check-row">
          <label class="check-label">
            <input id="eight" type="checkbox" ${state.eightConnected ? "checked" : ""}${disabled} />
            <span>8-connected (diagonals count)</span>
          </label>
          <label class="check-label">
            <input id="hide-source" type="checkbox" ${state.hideSource ? "checked" : ""}${disabled} />
            <span>Hide source layer after split</span>
          </label>
          <label class="check-label">
            <input id="group-layers" type="checkbox" ${state.groupLayers ? "checked" : ""}${disabled} />
            <span>Put results in a group</span>
          </label>
        </div>

        <div class="preview-wrap${state.scan ? " show" : ""}" id="preview-wrap">
          <div class="preview-title-row">
            <span>Preview</span>
            <strong>${
              state.scan
                ? `${count} element${count === 1 ? "" : "s"}`
                : "Not scanned yet"
            }</strong>
          </div>
          <div class="preview-card${state.scan ? " show" : ""}" id="preview-card">
            <canvas id="preview-canvas" aria-label="Detected elements preview"></canvas>
          </div>
          <p class="preview-meta" id="preview-meta">
            ${
              state.scan
                ? `Colored regions show what will become separate layers · ${state.scan.width}×${state.scan.height}`
                : "Preview detects separate opaque regions without changing your document."
            }
          </p>
        </div>

        <div class="panel-actions">
          <div class="status status-${state.statusKind}" role="status" aria-live="polite">
            ${statusIcon()}
            <span>${escapeHtml(state.statusText)}</span>
          </div>
          <div class="action-row">
            <button class="secondary" type="button" data-run="scan"${disabled}>Preview</button>
            <button class="primary" type="button" data-run="split"${splitDisabled}>Split into layers</button>
          </div>
        </div>
      </div>

      <footer class="panel-footer">
        <div class="panel-footer-copy">
          <span>Tested with Photopea ${escapeHtml(META.testedPhotopea)} · scripting v${escapeHtml(META.scriptingVersion)}</span>
          <span>Scan is read-only · Split creates new layers</span>
        </div>
        <a href="${META.repositoryUrl}" target="_blank" rel="noreferrer" title="View the Alpha Split source code on GitHub">
          View source <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </section>`;
}

function installerHtml() {
  const hostname = new URL(META.pluginUrl).host;

  return `
    <div class="install-layout">
      <section class="install-copy">
        <div class="eyebrow">
          <span class="eyebrow-dot"></span>
          Photopea plugin
          <span class="install-version">v${escapeHtml(META.version)}</span>
        </div>
        <h1>Split disconnected artwork into layers.</h1>
        <p class="intro">
          Detect separate opaque regions through the alpha channel, preview them,
          then create one layer for each element—ideal for asset sheets and
          scattered sprites.
        </p>
        <div class="feature-pills">
          <span>Alpha detection</span>
          <span>Connected components</span>
          <span>Safe scan</span>
          <span>Named layers</span>
        </div>
        <div class="install-actions">
          <button class="download-button" id="download-plugin" type="button">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v8m0 0 3-3m-3 3-3-3M4 14.5v2h12v-2"></path></svg>
            Download plugin
          </button>
          <a href="https://www.photopea.com" target="_blank" rel="noreferrer">Open Photopea <span aria-hidden="true">↗</span></a>
          <a href="${META.repositoryUrl}" target="_blank" rel="noreferrer">View source <span aria-hidden="true">↗</span></a>
        </div>
        <ol class="steps">
          <li><span>1</span><div><strong>Download the installer</strong><p>Save the small Alpha Split JSON file.</p></div></li>
          <li><span>2</span><div><strong>Open Window → Plugins</strong><p>Choose Add Plugin at the top of Photopea's plugin window.</p></div></li>
          <li><span>3</span><div><strong>Select the JSON file</strong><p>Open the panel and confirm it shows <strong>v${escapeHtml(META.version)}</strong>.</p></div></li>
        </ol>
        <p class="compatibility-note">
          Tested with Photopea ${escapeHtml(META.testedPhotopea)} · scripting v${escapeHtml(META.scriptingVersion)}
          · verified ${escapeHtml(META.verifiedLabel)}
        </p>
        <p class="privacy-note">Runs locally in Photopea. No document or image data is uploaded.</p>
      </section>
      <section class="preview-wrap" aria-label="Plugin preview">
        <div class="preview-label"><span>Plugin preview</span><span>${escapeHtml(hostname)}</span></div>
        ${panelHtml()}
      </section>
    </div>`;
}

function render() {
  const root = document.querySelector("#app");
  if (!root) return;
  root.className = state.embedded ? "embedded-shell" : "install-page";
  root.innerHTML = state.embedded ? panelHtml() : installerHtml();
  bindEvents();
  if (state.scan) drawPreview(state.scan);
}

function readInputs() {
  const readNumber = (selector, fallback) => {
    const value = Number(document.querySelector(selector)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  state.alphaThreshold = readNumber("#alpha", state.alphaThreshold);
  state.minSize = readNumber("#min-size", state.minSize);
  state.prefix = document.querySelector("#prefix")?.value ?? state.prefix;
  state.eightConnected =
    document.querySelector("#eight")?.checked ?? state.eightConnected;
  state.hideSource =
    document.querySelector("#hide-source")?.checked ?? state.hideSource;
  state.groupLayers =
    document.querySelector("#group-layers")?.checked ?? state.groupLayers;
}

function clearActiveRequest() {
  if (state.requestTimer !== null) window.clearTimeout(state.requestTimer);
  state.requestTimer = null;
  state.activeRequestId = null;
  state.activeOperation = null;
  state.pendingBinary = null;
  state.pendingDone = false;
  state.expectBinary = false;
}

function failActiveRequest(message) {
  clearActiveRequest();
  state.stage = "error";
  state.statusKind = "error";
  state.statusText = message;
  render();
}

function setWorking(stage, message, requestId, operation) {
  state.activeRequestId = requestId;
  state.activeOperation = operation;
  state.stage = stage;
  state.statusKind = "working";
  state.statusText = message;
  if (state.requestTimer !== null) window.clearTimeout(state.requestTimer);
  state.requestTimer = window.setTimeout(() => {
    if (state.activeRequestId !== requestId) return;
    failActiveRequest(
      `Photopea did not respond while ${stage}. Close and reopen the panel, then try again.`,
    );
  }, META.requestTimeoutMs);
}

function postScript(script) {
  window.parent.postMessage(script, "*");
}

function postBinary(buffer) {
  window.parent.postMessage(buffer, "*");
}

function commonHelpers() {
  return `
  var resultTag = ${JSON.stringify(RESULT_PREFIX)};
  var messageTag = ${JSON.stringify(MESSAGE_PREFIX)};
  function px(value) {
    if (typeof value === "number") return value;
    try { return value.as("px"); } catch (_) {}
    try { return Number(value.value); } catch (_) {}
    return Number(value);
  }
  function layerId(layer) {
    try { return Number(layer.id); } catch (_) { return -1; }
  }
  function documentSource(documentRef) {
    try { return String(documentRef.source || ""); } catch (_) { return ""; }
  }
  function findLayerById(container, wantedId) {
    if (wantedId === null || wantedId === undefined || wantedId < 0) return null;
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (layerId(item) === Number(wantedId)) return item;
      if (item.typename === "LayerSet") {
        var nested = findLayerById(item, wantedId);
        if (nested) return nested;
      }
    }
    return null;
  }
  function findLayerSetByName(container, wantedName) {
    for (var i = 0; i < container.layerSets.length; i++) {
      var group = container.layerSets[i];
      if (group.name === wantedName) return group;
      var nested = findLayerSetByName(group, wantedName);
      if (nested) return nested;
    }
    return null;
  }
  function findDocumentByName(name, skip) {
    if (!app.documents) return null;
    for (var i = 0; i < app.documents.length; i++) {
      var documentRef = app.documents[i];
      if (skip && documentRef === skip) continue;
      if (String(documentRef.name || "") === name) return documentRef;
    }
    return null;
  }
  function findSourceDocument(settings, temporaryDocument) {
    if (!app.documents) return null;
    if (settings.sourceDocumentSource) {
      for (var i = 0; i < app.documents.length; i++) {
        var documentRef = app.documents[i];
        if (documentRef === temporaryDocument) continue;
        if (documentSource(documentRef) === settings.sourceDocumentSource) return documentRef;
      }
    }
    return findDocumentByName(settings.sourceDocumentName, temporaryDocument);
  }
  function hideEveryLayer(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "LayerSet") hideEveryLayer(item);
      try { item.visible = false; } catch (_) {}
    }
  }
  function revealWithParents(layer, documentRef) {
    var current = layer;
    while (current && current !== documentRef) {
      try { current.visible = true; } catch (_) {}
      try { current = current.parent; } catch (_) { current = null; }
    }
  }
  function send(type, object) {
    object.type = type;
    object.requestId = settings && settings.requestId ? settings.requestId : object.requestId;
    app.echoToOE(messageTag + JSON.stringify(object));
  }`;
}

function makeCaptureScript(requestId) {
  return `
(function () {
  var settings = { requestId: ${JSON.stringify(requestId)} };
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open a document before scanning.");
    }
    var documentRef = app.activeDocument;
    var layer = documentRef.activeLayer;
    if (!layer) throw new Error("Select a layer first.");
    if (layer.typename !== "ArtLayer") {
      throw new Error("Select a single image layer, not a group.");
    }
    send("meta", {
      ok: true,
      documentName: documentRef.name,
      documentSource: documentSource(documentRef),
      layerId: layerId(layer),
      layerName: layer.name,
      width: px(documentRef.width),
      height: px(documentRef.height)
    });
    // Untouched PSD snapshot. Isolation never runs in the original workfile.
    // Echo meta first, then export in the same script so only one "done" follows the binary.
    app.activeDocument.saveToOE("psd");
  } catch (error) {
    send("error", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makePrepareTempScript({
  requestId,
  temporaryDocumentName,
  sourceDocumentName,
  sourceDocumentSource,
  sourceLayerId,
}) {
  const payload = JSON.stringify({
    requestId,
    temporaryDocumentName,
    sourceDocumentName,
    sourceDocumentSource,
    sourceLayerId,
  });

  return `
(function () {
  var settings = ${payload};
  var temporaryDocument = null;
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Photopea could not open the temporary PSD snapshot.");
    }
    temporaryDocument = app.activeDocument;
    temporaryDocument.name = settings.temporaryDocumentName;

    var captureLayer = findLayerById(temporaryDocument, settings.sourceLayerId);
    if (!captureLayer) captureLayer = temporaryDocument.activeLayer;
    if (!captureLayer || captureLayer.typename !== "ArtLayer") {
      throw new Error("The source layer could not be found in the temporary copy.");
    }

    hideEveryLayer(temporaryDocument);
    revealWithParents(captureLayer, temporaryDocument);
    app.activeDocument = temporaryDocument;
    temporaryDocument.saveToOE("png");
  } catch (error) {
    try {
      if (temporaryDocument && temporaryDocument !== findSourceDocument(settings, temporaryDocument)) {
        app.activeDocument = temporaryDocument;
        temporaryDocument.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try {
      var sourceDocument = findSourceDocument(settings, temporaryDocument);
      if (sourceDocument) app.activeDocument = sourceDocument;
    } catch (_) {}
    send("error", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeCloseTempScript({
  requestId,
  temporaryDocumentName,
  sourceDocumentName,
  sourceDocumentSource,
}) {
  const payload = JSON.stringify({
    requestId,
    temporaryDocumentName,
    sourceDocumentName,
    sourceDocumentSource,
  });

  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    var temporaryDocument = findDocumentByName(settings.temporaryDocumentName, null);
    var sourceDocument = findSourceDocument(settings, temporaryDocument);
    if (!temporaryDocument) {
      throw new Error("Photopea could not find the temporary capture document.");
    }
    app.activeDocument = temporaryDocument;
    temporaryDocument.close(SaveOptions.DONOTSAVECHANGES);
    if (findDocumentByName(settings.temporaryDocumentName, null)) {
      throw new Error("Photopea left the temporary capture document open.");
    }
    if (!sourceDocument) {
      throw new Error("Photopea could not find the original workfile.");
    }
    app.activeDocument = sourceDocument;
    if (app.activeDocument !== sourceDocument) {
      throw new Error("Photopea could not restore the original workfile.");
    }
    send("cleanup", {
      ok: true,
      temporaryDocumentClosed: true,
      sourceDocumentRestored: true
    });
  } catch (error) {
    send("cleanup", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makePlaceLayerScript({
  requestId,
  layer,
  index,
  total,
  groupName,
  groupLayers,
  hideSource,
  sourceLayerId,
  sourceLayerName,
  isLast,
}) {
  const payload = JSON.stringify({
    requestId,
    layer,
    index,
    total,
    groupName,
    groupLayers,
    hideSource,
    sourceLayerId,
    sourceLayerName,
    isLast,
  });

  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("The source document is no longer open.");
    }
    var documentRef = app.activeDocument;
    var sourceLayer = findLayerById(documentRef, settings.sourceLayerId);
    if (!sourceLayer) {
      for (var search = 0; search < documentRef.layers.length; search++) {
        if (documentRef.layers[search].name === settings.sourceLayerName) {
          sourceLayer = documentRef.layers[search];
          break;
        }
      }
    }
    if (!sourceLayer) throw new Error("The original source layer could not be found.");

    var group = null;
    if (settings.groupLayers) {
      group = findLayerSetByName(documentRef, settings.groupName);
      if (!group) {
        group = documentRef.layerSets.add();
        group.name = settings.groupName;
      }
    }

    documentRef.activeLayer = sourceLayer;
    app.open(settings.layer.dataUrl, null, true);
    var resultLayer = documentRef.activeLayer;
    if (!resultLayer || resultLayer === sourceLayer) {
      throw new Error("Photopea did not insert layer " + settings.layer.name + ".");
    }
    resultLayer.name = settings.layer.name;

    if (group) {
      try { resultLayer.move(group, ElementPlacement.INSIDE); }
      catch (_) {
        try { resultLayer.move(group, ElementPlacement.PLACEATBEGINNING); } catch (__) {}
      }
    }

    // Crops are placed as small smart objects — move them to the original bbox origin.
    try {
      var bounds = resultLayer.bounds;
      var dx = settings.layer.x - px(bounds[0]);
      var dy = settings.layer.y - px(bounds[1]);
      if (dx !== 0 || dy !== 0) resultLayer.translate(dx, dy);
    } catch (translateError) {}

    resultLayer.visible = true;

    if (settings.isLast && settings.hideSource) {
      try { sourceLayer.visible = false; } catch (_) {}
    }

    send("split-progress", {
      ok: true,
      index: settings.index,
      total: settings.total,
      name: settings.layer.name,
      done: !!settings.isLast
    });
  } catch (error) {
    send("split", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function decodePng(buffer) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: "image/png" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode the exported PNG."));
    };
    img.src = url;
  });
}

function imageDataToDataUrl(imageData) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    try {
      resolve(canvas.toDataURL("image/png"));
    } catch (error) {
      reject(error);
    }
  });
}

function drawPreview(scan) {
  const canvas = document.querySelector("#preview-canvas");
  if (!canvas || !scan || !scan.imageData) return;
  const { width, height, labels, imageData } = scan;
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(dw, dh);
  const src = imageData.data;
  const dst = out.data;
  const palette = [
    [76, 139, 245],
    [90, 158, 111],
    [208, 181, 106],
    [196, 92, 92],
    [168, 120, 200],
    [80, 180, 180],
    [220, 140, 80],
    [140, 160, 220],
  ];

  for (let py = 0; py < dh; py++) {
    const srcY = Math.min(height - 1, Math.floor(py / scale));
    for (let pxCol = 0; pxCol < dw; pxCol++) {
      const srcX = Math.min(width - 1, Math.floor(pxCol / scale));
      const srcIndex = srcY * width + srcX;
      const srcOffset = srcIndex << 2;
      const dstOffset = (py * dw + pxCol) << 2;
      const id = labels[srcIndex];
      if (!id) {
        dst[dstOffset] = src[srcOffset];
        dst[dstOffset + 1] = src[srcOffset + 1];
        dst[dstOffset + 2] = src[srcOffset + 2];
        dst[dstOffset + 3] = Math.min(src[srcOffset + 3], 60);
        continue;
      }
      const color = palette[(id - 1) % palette.length];
      dst[dstOffset] = (src[srcOffset] + color[0]) >> 1;
      dst[dstOffset + 1] = (src[srcOffset + 1] + color[1]) >> 1;
      dst[dstOffset + 2] = (src[srcOffset + 2] + color[2]) >> 1;
      dst[dstOffset + 3] = Math.max(src[srcOffset + 3], 180);
    }
  }

  ctx.putImageData(out, 0, 0);
}

function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function finishScanAnalysis(requestId, pngBuffer, meta) {
  if (state.activeRequestId !== requestId) return;

  setWorking("processing", "Detecting separate alpha regions…", requestId, "scan");
  render();

  const settings = settingsFromState();
  const validation = CORE.validateSettings(settings);
  if (!validation.ok) {
    failActiveRequest(validation.message);
    return;
  }

  try {
    const imageData = await decodePng(pngBuffer);
    if (state.activeRequestId !== requestId) return;

    const labeled = CORE.labelComponents(
      imageData,
      settings.alphaThreshold,
      settings.minSize,
      settings.eightConnected,
    );

    state.scan = {
      imageData,
      labels: labeled.labels,
      components: labeled.components,
      width: labeled.width,
      height: labeled.height,
      meta,
      settings,
    };

    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = labeled.components.length ? "ok" : "error";
    state.statusText = labeled.components.length
      ? `Scan complete: ${labeled.components.length} separate element${labeled.components.length === 1 ? "" : "s"} detected.`
      : "No elements matched your thresholds. Lower alpha threshold or min pixels.";
    render();
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function beginScan() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;

  readInputs();
  const validation = CORE.validateSettings(settingsFromState());
  if (!validation.ok) {
    state.stage = "error";
    state.statusKind = "error";
    state.statusText = validation.message;
    render();
    return;
  }

  const requestId = createRequestId();
  state.scan = null;
  state.pendingBinary = null;
  state.pendingDone = false;
  state._scanMeta = null;
  state.expectBinary = true;
  setWorking("receiving snapshot", "Reading layer and snapshotting the document…", requestId, "scan");
  render();

  try {
    postScript(makeCaptureScript(requestId));
  } catch (error) {
    failActiveRequest(
      error && error.message
        ? `Could not contact Photopea: ${error.message}`
        : "Could not contact Photopea.",
    );
  }
}

async function placeNextSplitLayer(requestId) {
  const job = state._splitJob;
  if (!job || state.activeRequestId !== requestId) return;

  if (job.index >= job.layers.length) {
    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = "ok";
    state.statusText = `Created ${job.layers.length} layer${job.layers.length === 1 ? "" : "s"} from alpha regions.`;
    state._splitJob = null;
    render();
    return;
  }

  const layer = job.layers[job.index];
  const isLast = job.index === job.layers.length - 1;
  setWorking(
    "processing",
    `Creating layer ${job.index + 1} / ${job.layers.length}: ${layer.name}`,
    requestId,
    "split",
  );
  render();

  try {
    postScript(
      makePlaceLayerScript({
        requestId,
        layer,
        index: job.index,
        total: job.layers.length,
        groupName: job.groupName,
        groupLayers: job.groupLayers,
        hideSource: job.hideSource,
        sourceLayerId: job.sourceLayerId,
        sourceLayerName: job.sourceLayerName,
        isLast,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function beginSplit() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;
  if (!state.scan || !state.scan.components.length) {
    state.statusKind = "error";
    state.statusText = "Scan a layer before splitting.";
    render();
    return;
  }

  readInputs();
  const settings = settingsFromState();
  const validation = CORE.validateSettings(settings);
  if (!validation.ok) {
    state.statusKind = "error";
    state.statusText = validation.message;
    render();
    return;
  }

  const requestId = createRequestId();
  setWorking("preparing", "Preparing separated layers…", requestId, "split");
  render();

  try {
    const layers = [];
    for (let index = 0; index < state.scan.components.length; index++) {
      if (state.activeRequestId !== requestId) return;
      const component = state.scan.components[index];
      const name = `${settings.prefix}_${padNumber(component.id, 2)}`;
      setWorking(
        "preparing",
        `Encoding crop ${index + 1} / ${state.scan.components.length}: ${name}`,
        requestId,
        "split",
      );
      render();

      const crop = CORE.extractComponentCrop(
        state.scan.imageData,
        state.scan.labels,
        component,
      );
      const dataUrl = await imageDataToDataUrl(crop.imageData);
      layers.push({
        name,
        dataUrl,
        x: crop.x,
        y: crop.y,
      });
      await yieldToUi();
    }

    if (state.activeRequestId !== requestId) return;

    state._splitJob = {
      layers,
      index: 0,
      groupName: `${settings.prefix}s`,
      groupLayers: settings.groupLayers,
      hideSource: settings.hideSource,
      sourceLayerId: state.scan.meta.layerId,
      sourceLayerName: state.scan.meta.layerName,
    };

    await placeNextSplitLayer(requestId);
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function handleBinary(buffer) {
  if (!state.activeRequestId || state.activeOperation !== "scan") return;
  if (state.stage === "receiving snapshot" || state.stage === "receiving file") {
    state.pendingBinary = buffer;
    if (state.pendingDone) {
      state.pendingDone = false;
      handleDone();
    }
  }
}

function openSnapshotCopy(requestId, snapshot) {
  const meta = state._scanMeta;
  if (!meta) {
    failActiveRequest("Photopea did not return layer details before the snapshot.");
    return;
  }
  const temporaryDocumentName = `alpha-split-temp-${requestId}`;
  state._tempName = temporaryDocumentName;
  state.pendingBinary = null;
  state.pendingDone = false;
  state.expectBinary = false;

  setWorking(
    "opening snapshot",
    "Opening an independent temporary copy…",
    requestId,
    "scan",
  );
  render();

  try {
    postBinary(snapshot);
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function prepareTemporaryExport(requestId) {
  const meta = state._scanMeta;
  const temporaryDocumentName = state._tempName;
  state.pendingBinary = null;
  state.pendingDone = false;
  state.expectBinary = true;

  setWorking(
    "receiving file",
    "Exporting the isolated active layer…",
    requestId,
    "scan",
  );
  render();

  try {
    postScript(
      makePrepareTempScript({
        requestId,
        temporaryDocumentName,
        sourceDocumentName: meta.documentName,
        sourceDocumentSource: meta.documentSource,
        sourceLayerId: meta.layerId,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function closeTemporaryAndAnalyze(requestId, pngBuffer) {
  const meta = state._scanMeta;
  const temporaryDocumentName = state._tempName;
  state.pendingBinary = null;
  state.pendingDone = false;
  state.expectBinary = false;
  state._pendingPng = pngBuffer;

  setWorking("cleaning up", "Closing the temporary copy…", requestId, "scan");
  render();

  try {
    postScript(
      makeCloseTempScript({
        requestId,
        temporaryDocumentName,
        sourceDocumentName: meta.documentName,
        sourceDocumentSource: meta.documentSource,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function handleDone() {
  if (!state.activeRequestId || state.activeOperation !== "scan") return;

  if (state.stage === "receiving snapshot") {
    // Capture script sends: meta echo → PSD ArrayBuffer → "done" (order can vary slightly).
    if (!state.pendingBinary || !state._scanMeta) {
      state.pendingDone = true;
      return;
    }
    openSnapshotCopy(state.activeRequestId, state.pendingBinary);
    return;
  }

  if (state.stage === "opening snapshot") {
    prepareTemporaryExport(state.activeRequestId);
    return;
  }

  if (state.stage === "receiving file") {
    if (!state.pendingBinary) {
      state.pendingDone = true;
      return;
    }
    closeTemporaryAndAnalyze(state.activeRequestId, state.pendingBinary);
  }
}

function handleTaggedMessage(payload) {
  if (
    !state.activeRequestId ||
    !payload ||
    payload.requestId !== state.activeRequestId
  ) {
    return;
  }

  if (payload.type === "meta") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not read the active layer.");
      return;
    }
    state._scanMeta = payload;
    if (
      state.stage === "receiving snapshot" &&
      state.pendingBinary &&
      state.pendingDone
    ) {
      state.pendingDone = false;
      handleDone();
    }
    return;
  }

  if (payload.type === "cleanup") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not restore the original workfile.");
      return;
    }
    const pngBuffer = state._pendingPng;
    state._pendingPng = null;
    finishScanAnalysis(payload.requestId, pngBuffer, state._scanMeta);
    return;
  }

  if (payload.type === "split-progress") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not create a split layer.");
      return;
    }
    if (!state._splitJob) return;
    state._splitJob.index = payload.index + 1;
    if (payload.done) {
      clearActiveRequest();
      state.stage = "complete";
      state.statusKind = "ok";
      state.statusText = `Created ${payload.total} layer${payload.total === 1 ? "" : "s"} from alpha regions.`;
      state._splitJob = null;
      render();
      return;
    }
    placeNextSplitLayer(payload.requestId);
    return;
  }

  if (payload.type === "split") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not create the split layers.");
      return;
    }
    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = "ok";
    state.statusText = `Created ${payload.created} layer${payload.created === 1 ? "" : "s"} from alpha regions.`;
    render();
    return;
  }

  if (payload.type === "error") {
    failActiveRequest(payload.message || "Photopea reported an error.");
  }
}

function downloadInstaller() {
  const manifest = {
    name: META.name,
    url: versionedUrl("./"),
    icon: `===${versionedUrl("assets/icon.svg")}`,
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = "alpha-split-photopea.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

function bindEvents() {
  document.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.run === "scan") beginScan();
      if (button.dataset.run === "split") beginSplit();
    });
  });

  document
    .querySelector("#download-plugin")
    ?.addEventListener("click", downloadInstaller);

  document.querySelectorAll(".panel-body input").forEach((input) => {
    input.addEventListener("input", () => {
      readInputs();
      if (state.statusKind !== "working") {
        state.statusKind = "idle";
        state.statusText =
          "Adjust thresholds if needed, then preview the active layer.";
      }
    });
    input.addEventListener("change", () => {
      readInputs();
    });
  });
}

window.addEventListener("message", (event) => {
  if (!state.embedded || event.source !== window.parent) return;

  if (event.data instanceof ArrayBuffer) {
    handleBinary(event.data);
    return;
  }

  if (event.data === "done") {
    handleDone();
    return;
  }

  if (typeof event.data !== "string") return;

  if (event.data.startsWith(MESSAGE_PREFIX)) {
    try {
      handleTaggedMessage(JSON.parse(event.data.slice(MESSAGE_PREFIX.length)));
    } catch {
      failActiveRequest("Photopea returned an unreadable result.");
    }
    return;
  }

  if (event.data.startsWith(RESULT_PREFIX)) {
    try {
      handleTaggedMessage(JSON.parse(event.data.slice(RESULT_PREFIX.length)));
    } catch {
      failActiveRequest("Photopea returned an unreadable result.");
    }
  }
});

state.statusText = state.embedded
  ? "Select a layer with transparent gaps, then preview."
  : "Interactive plugin preview.";
render();
