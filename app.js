"use strict";

const META = window.ALPHA_SPLIT_META;
const CORE = window.AlphaSplitCore;
const ZIP = window.AlphaSplitZip;
const DATA = window.AlphaSplitData;
const RESULT_PREFIX = "ALPHA_SPLIT_RESULT::";
const MESSAGE_PREFIX = "ALPHA_SPLIT::";
const READY_MESSAGE = "ALPHA_SPLIT_DIRECTORY_READY";
const CANCEL_MESSAGE = "ALPHA_SPLIT_DIRECTORY_CANCELLED";
const DB_NAME = "photopea-alpha-split";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "export-directory";

if (!META || !CORE || !ZIP || !DATA) {
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
  destination: "folder",
  folderHandle: null,
  folderName: "",
  folderPermission: "none",
  folderData: null,
  exportAfterFolderChoice: false,
  assembleAfterFolderChoice: false,
  pickerWindow: null,
  editTool: "sample",
  sampledLabel: null,
  previewHover: null,
  previewHoverRaf: null,
  stage: "idle",
  statusKind: "idle",
  statusText: "",
  scan: null,
  previewObserver: null,
  activeRequestId: null,
  activeOperation: null,
  requestTimer: null,
  pendingBinary: null,
  pendingDone: false,
  // Data-layer traffic runs on its own tokens so it never blocks the panel.
  dataLayerWaits: new Map(),
  latestSplitData: null,
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
  };
}

function folderIcon() {
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.8 5.5h6l1.6 2h6.8v8H2.8z"></path>
      <path d="M5 12h10"></path>
    </svg>`;
}

function zipIcon() {
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.8h7l3 3v11.4H5z"></path>
      <path d="M12 2.8v3h3M8.5 5h2M8.5 8h2M8.5 11h2M8.5 14h2"></path>
    </svg>`;
}

function destinationHtml(disabled) {
  const folderSelected = state.destination === "folder" ? " selected" : "";
  const zipSelected = state.destination === "zip" ? " selected" : "";

  let folderBody;
  if (state.destination === "zip") {
    folderBody = `
      <div class="destination-card">
        <div class="destination-icon">${zipIcon()}</div>
        <div class="destination-copy">
          <strong>ZIP download</strong>
          <span>One archive with every cropped PNG</span>
        </div>
      </div>`;
  } else {
    const title = state.folderName || "Export folder not selected";
    let subtitle = "Choose where PNG files will be written";
    if (state.folderPermission === "granted") {
      subtitle = "Remembered by this browser";
    } else if (state.folderName) {
      subtitle = "Access will be restored in a secure folder window";
    }
    folderBody = `
      <div class="destination-card">
        <div class="destination-icon">${folderIcon()}</div>
        <div class="destination-copy">
          <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle)}</span>
        </div>
        <button class="small-button" id="choose-folder" type="button"${disabled}>
          ${state.folderName ? "Change" : "Choose"}
        </button>
      </div>`;
  }

  return `
    <p class="section-label">Destination</p>
    <div class="destination-toggle" role="group" aria-label="Export destination">
      <button type="button" class="destination-option${folderSelected}" data-destination="folder"${disabled}>Folder</button>
      <button type="button" class="destination-option${zipSelected}" data-destination="zip"${disabled}>ZIP</button>
    </div>
    ${folderBody}`;
}

function sampleIndicatorHtml() {
  if (state.sampledLabel === "new") {
    return `<span class="sample-swatch sample-swatch-new" aria-hidden="true"></span><span>Sample: New label</span>`;
  }
  if (typeof state.sampledLabel === "number" && state.sampledLabel > 0) {
    const color =
      (state.scan &&
        state.scan.labelColors &&
        state.scan.labelColors.get(state.sampledLabel)) ||
      [120, 120, 120];
    return `<span class="sample-swatch" style="background:rgb(${color[0]},${color[1]},${color[2]})" aria-hidden="true"></span><span>Sample: ${escapeHtml(elementTitle(state.sampledLabel))}</span>`;
  }
  return `<span class="sample-swatch sample-swatch-empty" aria-hidden="true"></span><span>Sample: None</span>`;
}

function previewToolbarHtml(disabled) {
  if (!state.scan) return "";
  const sampleActive = state.editTool === "sample" ? " tool-active" : "";
  const fillActive = state.editTool === "fill" ? " tool-active" : "";
  const updateDisabled =
    disabled || !(state.scan.labelsEdited && !state.scan.labelsCommitted)
      ? " disabled"
      : "";
  const dirty =
    state.scan.labelsEdited && !state.scan.labelsCommitted
      ? '<span class="preview-dirty">unsaved edits</span>'
      : "";

  return `
    <div class="preview-toolbar" role="toolbar" aria-label="Preview edit tools">
      <button type="button" class="tool-button" data-preview-action="randomize"${disabled}>Randomize colors</button>
      <button type="button" class="tool-button${sampleActive}" data-preview-action="sample"${disabled}>Sample</button>
      <button type="button" class="tool-button${fillActive}" data-preview-action="fill"${disabled}>Fill</button>
      <button type="button" class="tool-button" data-preview-action="update"${updateDisabled}>Update</button>
    </div>
    <div class="sample-row">
      <div class="sample-indicator">${sampleIndicatorHtml()}</div>
      <button type="button" class="small-button" data-preview-action="sample-new"${disabled}>New</button>
      ${dirty}
    </div>`;
}

function panelHtml() {
  const busy = state.statusKind === "working";
  const disabled = busy ? " disabled" : "";
  const settingsMatch =
    !state.scan ||
    (!state.scan.settingsInvalidated &&
      state.scan.settings &&
      state.scan.settings.alphaThreshold === Number(state.alphaThreshold) &&
      state.scan.settings.minSize === Number(state.minSize) &&
      !!state.scan.settings.eightConnected === !!state.eightConnected);
  const canExport =
    !busy &&
    state.scan &&
    state.scan.components.length > 0 &&
    settingsMatch &&
    !(state.scan.labelsEdited && !state.scan.labelsCommitted);
  const exportDisabled = canExport ? "" : " disabled";
  const canAssemble =
    !busy &&
    state.destination === "folder" &&
    state.folderPermission === "granted" &&
    state.folderData &&
    state.folderData.elements &&
    state.folderData.elements.length > 0;
  const assembleDisabled = canAssemble ? "" : " disabled";
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
          <p>Export by alpha regions</p>
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
          <span>File name prefix</span>
          <input id="prefix" value="${escapeHtml(state.prefix)}" placeholder="element"${disabled} />
        </label>

        <div class="check-row">
          <label class="check-label">
            <input id="eight" type="checkbox" ${state.eightConnected ? "checked" : ""}${disabled} />
            <span>8-connected (diagonals count)</span>
          </label>
        </div>

        ${destinationHtml(disabled)}

        <div class="preview-wrap${state.scan ? " show" : ""}" id="preview-wrap">
          <div class="preview-title-row">
            <span>Preview</span>
            <strong id="preview-count">${
              state.scan
                ? `${count} element${count === 1 ? "" : "s"}`
                : "Not scanned yet"
            }</strong>
          </div>
          ${previewToolbarHtml(disabled)}
          <div class="preview-card${state.scan ? " show" : ""}" id="preview-card">
            <canvas id="preview-canvas" aria-label="Detected elements preview"></canvas>
            <div id="preview-hover-tip" class="preview-hover-tip" hidden></div>
          </div>
          <p class="preview-meta" id="preview-meta">
            ${
              state.scan
                ? `Click to Sample/Fill · ${state.scan.width}×${state.scan.height}${
                    state.scan.analysisScale < 0.999
                      ? ` · edit @ ${state.scan.analysisWidth}×${state.scan.analysisHeight}`
                      : ""
                  }`
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
            <button class="primary" type="button" data-run="export"${exportDisabled}>Export elements</button>
          </div>
          <div class="action-row action-row-single">
            <button class="secondary" type="button" data-run="assemble"${assembleDisabled}>Assemble Elements</button>
          </div>
        </div>
      </div>

      <footer class="panel-footer">
        <div class="panel-footer-copy">
          <span>Tested with Photopea ${escapeHtml(META.testedPhotopea)} · scripting v${escapeHtml(META.scriptingVersion)}</span>
          <span>Assemble imports all then positions · data restores on Preview</span>
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
        <h1>Export disconnected artwork as PNGs.</h1>
        <p class="intro">
          Detect separate opaque regions through the alpha channel, preview them,
          then export one cropped PNG for each element—ideal for asset sheets and
          scattered sprites.
        </p>
        <div class="feature-pills">
          <span>Alpha detection</span>
          <span>Connected components</span>
          <span>Safe preview</span>
          <span>Folder or ZIP</span>
          <span>Assemble</span>
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
  if (state.scan) {
    drawPreview(state.scan);
    observePreviewResize();
  }
}

function readInputs() {
  const readNumber = (selector, fallback) => {
    const value = Number(document.querySelector(selector)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const previous = {
    alphaThreshold: state.alphaThreshold,
    minSize: state.minSize,
    eightConnected: state.eightConnected,
  };
  state.alphaThreshold = readNumber("#alpha", state.alphaThreshold);
  state.minSize = readNumber("#min-size", state.minSize);
  state.prefix = document.querySelector("#prefix")?.value ?? state.prefix;
  state.eightConnected =
    document.querySelector("#eight")?.checked ?? state.eightConnected;

  if (
    state.scan &&
    (previous.alphaThreshold !== state.alphaThreshold ||
      previous.minSize !== state.minSize ||
      previous.eightConnected !== state.eightConnected)
  ) {
    // Settings changed — export blocked until a fresh Preview.
    state.scan.settingsInvalidated = true;
  }
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

function operationTimeoutMs(operation, meta, elementCount) {
  const width = Number(meta && meta.width) || 0;
  const height = Number(meta && meta.height) || 0;
  const megapixels = (width * height) / 1e6;
  const base = META.requestTimeoutMs || 180000;
  if (operation === "scan") {
    return Math.min(900000, Math.max(base, 90000 + megapixels * 12000));
  }
  return Math.min(
    1200000,
    Math.max(base, 120000 + megapixels * 8000 + (elementCount || 0) * 6000),
  );
}

function setWorking(stage, message, requestId, operation, timeoutMs) {
  state.activeRequestId = requestId;
  state.activeOperation = operation;
  state.stage = stage;
  state.statusKind = "working";
  state.statusText = message;
  if (state.requestTimer !== null) window.clearTimeout(state.requestTimer);
  const waitMs =
    timeoutMs ||
    operationTimeoutMs(operation, state._scanMeta || (state.scan && state.scan.meta), state.scan && state.scan.components && state.scan.components.length);
  state.requestTimer = window.setTimeout(() => {
    if (state.activeRequestId !== requestId) return;
    failActiveRequest(
      `Photopea did not respond while ${stage}. Close and reopen the panel, then try again.`,
    );
  }, waitMs);
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
  function findArtLayerByName(container, wantedName) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "ArtLayer" && item.name === wantedName) return item;
      if (item.typename === "LayerSet") {
        var nested = findArtLayerByName(item, wantedName);
        if (nested) return nested;
      }
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

function makeUpsertDataLayerScript({ requestId, jsonText }) {
  const payload = JSON.stringify({
    requestId,
    layerName: DATA.DATA_LAYER_NAME,
    jsonText,
  });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open a document before saving Alpha Split data.");
    }
    var documentRef = app.activeDocument;
    var layer = findArtLayerByName(documentRef, settings.layerName);
    if (!layer) {
      layer = documentRef.artLayers.add();
      layer.kind = LayerKind.TEXT;
      layer.name = settings.layerName;
    }
    try { layer.kind = LayerKind.TEXT; } catch (_) {}
    try { layer.textItem.contents = settings.jsonText; } catch (textError) {
      throw new Error("Could not write the Alpha Split data layer text.");
    }
    try { layer.visible = false; } catch (_) {}
    send("data-layer", { ok: true, written: true });
  } catch (error) {
    send("data-layer", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeReadDataLayerScript(requestId) {
  const payload = JSON.stringify({
    requestId,
    layerName: DATA.DATA_LAYER_NAME,
  });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      send("data-layer", { ok: true, found: false, jsonText: null });
      return;
    }
    var documentRef = app.activeDocument;
    var layer = findArtLayerByName(documentRef, settings.layerName);
    if (!layer) {
      send("data-layer", { ok: true, found: false, jsonText: null });
      return;
    }
    var text = "";
    try { text = String(layer.textItem.contents || ""); } catch (_) { text = ""; }
    send("data-layer", { ok: true, found: true, jsonText: text });
  } catch (error) {
    send("data-layer", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeAssembleEnsureGroupScript({ requestId, groupName }) {
  const payload = JSON.stringify({ requestId, groupName });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("The source document is no longer open.");
    }
    var documentRef = app.activeDocument;
    // Prefer a root art layer so new groups are not nested under an active set.
    try {
      for (var i = 0; i < documentRef.layers.length; i++) {
        if (documentRef.layers[i].typename === "ArtLayer") {
          documentRef.activeLayer = documentRef.layers[i];
          break;
        }
      }
    } catch (_) {}

    var group = null;
    for (var g = 0; g < documentRef.layerSets.length; g++) {
      if (documentRef.layerSets[g].name === settings.groupName) {
        group = documentRef.layerSets[g];
        break;
      }
    }
    if (!group) {
      group = documentRef.layerSets.add();
      group.name = settings.groupName;
    }
    send("assemble-group", {
      ok: true,
      groupId: layerId(group),
      groupName: settings.groupName
    });
  } catch (error) {
    send("assemble-group", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeAssembleOpenScript({ requestId, dataUrl }) {
  const payload = JSON.stringify({ requestId, dataUrl });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("The source document is no longer open.");
    }
    app.open(settings.dataUrl, null, true);
  } catch (error) {
    send("assemble", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeAssembleCaptureScript({ requestId, index, total, name }) {
  const payload = JSON.stringify({ requestId, index, total, name });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("The source document is no longer open.");
    }
    var resultLayer = app.activeDocument.activeLayer;
    if (!resultLayer) {
      throw new Error("Photopea did not insert layer " + settings.name + ".");
    }
    if (resultLayer.typename === "LayerSet") {
      send("assemble-placed", {
        ok: false,
        notReady: true,
        message: "Smart Object is not ready yet."
      });
      return;
    }
    try { resultLayer.name = settings.name; } catch (_) {}
    send("assemble-placed", {
      ok: true,
      index: settings.index,
      total: settings.total,
      name: settings.name,
      layerId: layerId(resultLayer)
    });
  } catch (error) {
    send("assemble", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeAssembleBatchFinishScript({
  requestId,
  groupId,
  groupName,
  placements,
}) {
  const payload = JSON.stringify({
    requestId,
    groupId,
    groupName,
    placements,
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
    var group = null;
    if (settings.groupId != null && settings.groupId >= 0) {
      group = findLayerById(documentRef, settings.groupId);
    }
    if (!group || group.typename !== "LayerSet") {
      for (var g = 0; g < documentRef.layerSets.length; g++) {
        if (documentRef.layerSets[g].name === settings.groupName) {
          group = documentRef.layerSets[g];
          break;
        }
      }
    }
    if (!group || group.typename !== "LayerSet") {
      throw new Error("Assemble group “" + settings.groupName + "” is missing.");
    }

    var placed = 0;
    var list = settings.placements || [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var resultLayer = findLayerById(documentRef, item.layerId);
      if (!resultLayer || resultLayer.typename === "LayerSet") continue;
      try { resultLayer.name = item.name; } catch (_) {}
      try { resultLayer.move(group, ElementPlacement.INSIDE); }
      catch (_) {
        try { resultLayer.move(group, ElementPlacement.PLACEATBEGINNING); } catch (__) {}
      }
      try {
        var bounds = resultLayer.bounds;
        var dx = item.x - px(bounds[0]);
        var dy = item.y - px(bounds[1]);
        if (dx !== 0 || dy !== 0) resultLayer.translate(dx, dy);
      } catch (_) {}
      try { resultLayer.visible = true; } catch (_) {}
      placed += 1;
    }

    send("assemble-batch", {
      ok: true,
      placed: placed,
      total: list.length,
      done: true
    });
  } catch (error) {
    send("assemble", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function imageDataToPngBytes(imageData) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode a PNG crop."));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      },
      "image/png",
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDirectoryHandle(handle) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

async function loadStoredDirectoryHandle() {
  try {
    const database = await openDatabase();
    const handle = await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();

    state.folderHandle = handle;
    state.folderName = (handle && handle.name) || "";
    state.folderPermission = "none";

    if (handle && handle.queryPermission) {
      state.folderPermission = await handle.queryPermission({
        mode: "readwrite",
      });
    }
  } catch {
    state.folderHandle = null;
    state.folderName = "";
    state.folderPermission = "none";
  }
}

function openFolderPicker(mode = "choose") {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to choose an export folder.";
    render();
    return;
  }

  const pickerUrl = new URL("picker.html", pluginBaseUrl());
  pickerUrl.searchParams.set("from", "photopea");
  pickerUrl.searchParams.set("mode", mode);
  pickerUrl.searchParams.set("v", META.version);
  state.pickerWindow = window.open(
    pickerUrl.href,
    "photopea-alpha-split-folder",
    "popup=yes,width=500,height=560",
  );

  if (!state.pickerWindow) {
    state.exportAfterFolderChoice = false;
    state.statusKind = "error";
    state.statusText =
      "The folder window was blocked. Allow pop-ups for this plugin, or switch destination to ZIP.";
    render();
    return;
  }

  state.statusKind = "idle";
  state.statusText =
    mode === "restore"
      ? "Restore folder access in the secure window to continue exporting."
      : "Choose an export folder in the new window.";
  render();
}

async function ensureFolderPermission() {
  if (!state.folderHandle) {
    openFolderPicker("choose");
    return false;
  }

  let permission = state.folderPermission;
  if (state.folderHandle.queryPermission) {
    permission = await state.folderHandle.queryPermission({ mode: "readwrite" });
    state.folderPermission = permission;
  }

  if (permission === "granted") return true;

  if (state.folderHandle.requestPermission) {
    try {
      permission = await state.folderHandle.requestPermission({
        mode: "readwrite",
      });
      state.folderPermission = permission;
      if (permission === "granted") return true;
    } catch {
      // Cross-origin iframes often block requestPermission — use the popup.
    }
  }

  openFolderPicker("restore");
  return false;
}

async function writeFileToDirectory(filename, bytes) {
  const fileHandle = await state.folderHandle.getFileHandle(filename, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return filename;
}

function decodePng(buffer, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: "image/png" }));
    const img = new Image();
    img.onload = () => {
      const fullWidth = img.naturalWidth;
      const fullHeight = img.naturalHeight;
      const limit = Number(maxSide) > 0 ? Number(maxSide) : 0;
      const scale =
        limit > 0 ? Math.min(1, limit / Math.max(fullWidth, fullHeight)) : 1;
      const width = Math.max(1, Math.round(fullWidth * scale));
      const height = Math.max(1, Math.round(fullHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve({
        imageData: ctx.getImageData(0, 0, width, height),
        fullWidth,
        fullHeight,
        scale,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode the exported PNG."));
    };
    img.src = url;
  });
}

function elementTitle(labelId) {
  return `${state.prefix}_${padNumber(labelId, 2)}`;
}

function labelColor(scan, labelId) {
  return (
    (scan.labelColors && scan.labelColors.get(labelId)) || [76, 139, 245]
  );
}

function clearPreviewHover() {
  state.previewHover = null;
  const tip = document.querySelector("#preview-hover-tip");
  if (tip) tip.hidden = true;
}

function updatePreviewHoverTip(hover, card) {
  const tip = document.querySelector("#preview-hover-tip");
  if (!tip || !hover || !state.scan) {
    if (tip) tip.hidden = true;
    return;
  }
  const color = labelColor(state.scan, hover.label);
  tip.hidden = false;
  tip.innerHTML = `<span class="sample-swatch" style="background:rgb(${color[0]},${color[1]},${color[2]})" aria-hidden="true"></span><span>${escapeHtml(elementTitle(hover.label))}</span>`;
  const tipWidth = tip.offsetWidth || 120;
  const tipHeight = tip.offsetHeight || 24;
  let left = hover.tipX + 12;
  let top = hover.tipY + 12;
  left = Math.max(4, Math.min(left, card.clientWidth - tipWidth - 4));
  top = Math.max(4, Math.min(top, card.clientHeight - tipHeight - 4));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function fitPreviewLayout(card, analysisW, analysisH) {
  const maxW = Math.max(1, Math.floor((card && card.clientWidth) || 320));
  const maxH = Math.max(
    1,
    Math.floor((card && card.clientHeight) || Math.min(maxW, 240)),
  );
  const fit = Math.min(maxW / analysisW, maxH / analysisH);
  const cssW = Math.max(1, Math.floor(analysisW * fit));
  const cssH = Math.max(1, Math.floor(analysisH * fit));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const dw = Math.max(1, Math.round(cssW * dpr));
  const dh = Math.max(1, Math.round(cssH * dpr));
  return {
    cssW,
    cssH,
    dw,
    dh,
    scaleX: analysisW / dw,
    scaleY: analysisH / dh,
    outlineRadius: Math.max(1, Math.round(2.5 * dpr)),
  };
}

function drawIslandOutline(
  ctx,
  islandMask,
  analysisW,
  analysisH,
  scaleX,
  scaleY,
  dw,
  dh,
  outlineRadius,
) {
  const imageData = ctx.getImageData(0, 0, dw, dh);
  const dst = imageData.data;
  const radius = Math.max(1, outlineRadius | 0);

  const inIsland = (sx, sy) => {
    if (sx < 0 || sy < 0 || sx >= analysisW || sy >= analysisH) return false;
    return !!islandMask[sy * analysisW + sx];
  };

  const isEdge = (sx, sy) => {
    if (!inIsland(sx, sy)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!inIsland(sx + dx, sy + dy)) return true;
      }
    }
    return false;
  };

  for (let py = 0; py < dh; py++) {
    const srcY = Math.min(analysisH - 1, Math.floor(py * scaleY));
    for (let pxCol = 0; pxCol < dw; pxCol++) {
      const srcX = Math.min(analysisW - 1, Math.floor(pxCol * scaleX));
      if (!isEdge(srcX, srcY)) continue;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = py + oy;
        if (yy < 0 || yy >= dh) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = pxCol + ox;
          if (xx < 0 || xx >= dw) continue;
          const dstOffset = (yy * dw + xx) << 2;
          dst[dstOffset] = 255;
          dst[dstOffset + 1] = 255;
          dst[dstOffset + 2] = 255;
          dst[dstOffset + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawPreview(scan) {
  const canvas = document.querySelector("#preview-canvas");
  const card = document.querySelector("#preview-card");
  if (!canvas || !scan || !scan.imageData) return;

  const width = scan.analysisWidth || scan.imageData.width;
  const height = scan.analysisHeight || scan.imageData.height;
  const labels = scan.labels;
  const imageData = scan.imageData;
  const layout = fitPreviewLayout(card, width, height);
  scan.previewLayout = layout;

  if (canvas.width !== layout.dw || canvas.height !== layout.dh) {
    canvas.width = layout.dw;
    canvas.height = layout.dh;
  }
  canvas.style.width = `${layout.cssW}px`;
  canvas.style.height = `${layout.cssH}px`;

  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(layout.dw, layout.dh);
  const src = imageData.data;
  const dst = out.data;
  const colors = scan.labelColors;

  for (let py = 0; py < layout.dh; py++) {
    const srcY = Math.min(height - 1, Math.floor(py * layout.scaleY));
    for (let pxCol = 0; pxCol < layout.dw; pxCol++) {
      const srcX = Math.min(width - 1, Math.floor(pxCol * layout.scaleX));
      const srcIndex = srcY * width + srcX;
      const srcOffset = srcIndex << 2;
      const dstOffset = (py * layout.dw + pxCol) << 2;
      const id = labels[srcIndex];
      if (!id) {
        dst[dstOffset] = src[srcOffset];
        dst[dstOffset + 1] = src[srcOffset + 1];
        dst[dstOffset + 2] = src[srcOffset + 2];
        dst[dstOffset + 3] = Math.min(src[srcOffset + 3], 60);
        continue;
      }
      const color = (colors && colors.get(id)) || [76, 139, 245];
      const alpha = src[srcOffset + 3];
      dst[dstOffset] = color[0];
      dst[dstOffset + 1] = color[1];
      dst[dstOffset + 2] = color[2];
      dst[dstOffset + 3] = alpha;
    }
  }

  ctx.putImageData(out, 0, 0);

  if (
    state.editTool === "fill" &&
    state.previewHover &&
    state.previewHover.islandMask
  ) {
    drawIslandOutline(
      ctx,
      state.previewHover.islandMask,
      width,
      height,
      layout.scaleX,
      layout.scaleY,
      layout.dw,
      layout.dh,
      layout.outlineRadius,
    );
  }

  if (state.previewHover && card) {
    updatePreviewHoverTip(state.previewHover, card);
  }
}

function updatePreviewChrome() {
  const countEl = document.querySelector("#preview-count");
  if (countEl && state.scan) {
    const count = state.scan.components.length;
    countEl.textContent = `${count} element${count === 1 ? "" : "s"}`;
  }
  const indicator = document.querySelector(".sample-indicator");
  if (indicator) indicator.innerHTML = sampleIndicatorHtml();
  const dirty = document.querySelector(".preview-dirty");
  const sampleRow = document.querySelector(".sample-row");
  if (sampleRow) {
    const shouldShow =
      state.scan && state.scan.labelsEdited && !state.scan.labelsCommitted;
    if (shouldShow && !dirty) {
      const badge = document.createElement("span");
      badge.className = "preview-dirty";
      badge.textContent = "unsaved edits";
      sampleRow.appendChild(badge);
    } else if (!shouldShow && dirty) {
      dirty.remove();
    }
  }
  const updateBtn = document.querySelector('[data-preview-action="update"]');
  if (updateBtn) {
    updateBtn.disabled = !(
      state.scan &&
      state.scan.labelsEdited &&
      !state.scan.labelsCommitted
    );
  }
  document.querySelectorAll("[data-preview-action]").forEach((button) => {
    if (button.dataset.previewAction === "sample") {
      button.classList.toggle("tool-active", state.editTool === "sample");
    }
    if (button.dataset.previewAction === "fill") {
      button.classList.toggle("tool-active", state.editTool === "fill");
    }
  });
}

function canvasToAnalysisCoords(event, canvas, scan) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ax = Math.floor(
    ((event.clientX - rect.left) / rect.width) * scan.analysisWidth,
  );
  const ay = Math.floor(
    ((event.clientY - rect.top) / rect.height) * scan.analysisHeight,
  );
  if (
    ax < 0 ||
    ay < 0 ||
    ax >= scan.analysisWidth ||
    ay >= scan.analysisHeight
  ) {
    return null;
  }
  return { x: ax, y: ay };
}

function handlePreviewMouseMove(event) {
  const scan = state.scan;
  const canvas = document.querySelector("#preview-canvas");
  const card = document.querySelector("#preview-card");
  if (!scan || !canvas || !card || state.statusKind === "working") return;

  const coords = canvasToAnalysisCoords(event, canvas, scan);
  if (!coords) {
    clearPreviewHover();
    drawPreview(scan);
    return;
  }

  const label = scan.labels[coords.y * scan.analysisWidth + coords.x];
  if (!label) {
    clearPreviewHover();
    drawPreview(scan);
    return;
  }

  const cardRect = card.getBoundingClientRect();
  const hover = {
    ax: coords.x,
    ay: coords.y,
    label,
    tipX: event.clientX - cardRect.left,
    tipY: event.clientY - cardRect.top,
    islandMask: null,
  };

  if (state.editTool === "fill") {
    const island = CORE.floodIsland(
      scan.labels,
      scan.analysisWidth,
      scan.analysisHeight,
      coords.x,
      coords.y,
      state.eightConnected,
    );
    hover.islandMask = island.mask;
  }

  state.previewHover = hover;
  drawPreview(scan);
}

function schedulePreviewHover(event) {
  state.pendingHoverEvent = event;
  if (state.previewHoverRaf !== null) return;
  state.previewHoverRaf = window.requestAnimationFrame(() => {
    state.previewHoverRaf = null;
    const pending = state.pendingHoverEvent;
    state.pendingHoverEvent = null;
    if (pending) handlePreviewMouseMove(pending);
  });
}

function handlePreviewMouseLeave() {
  if (state.previewHoverRaf !== null) {
    window.cancelAnimationFrame(state.previewHoverRaf);
    state.previewHoverRaf = null;
  }
  state.pendingHoverEvent = null;
  clearPreviewHover();
  if (state.scan) drawPreview(state.scan);
}

function handlePreviewClick(event) {
  const scan = state.scan;
  const canvas = document.querySelector("#preview-canvas");
  if (!scan || !canvas || state.statusKind === "working") return;
  const coords = canvasToAnalysisCoords(event, canvas, scan);
  if (!coords) return;
  const index = coords.y * scan.analysisWidth + coords.x;
  const label = scan.labels[index];
  if (!label) return;

  if (state.editTool === "sample") {
    state.sampledLabel = label;
    updatePreviewChrome();
    return;
  }

  if (state.editTool === "fill") {
    const island = CORE.floodIsland(
      scan.labels,
      scan.analysisWidth,
      scan.analysisHeight,
      coords.x,
      coords.y,
      state.eightConnected,
    );
    if (!island.size) return;
    const target =
      state.sampledLabel === "new" || state.sampledLabel === null
        ? CORE.nextLabelId(scan.labels)
        : state.sampledLabel;
    if (target === island.label) return;
    CORE.relabelIsland(scan.labels, island.mask, target);
    if (!scan.labelColors.has(target)) {
      const fresh = CORE.createRandomPalette([target]);
      scan.labelColors.set(target, fresh.get(target));
    }
    scan.labelsEdited = true;
    scan.labelsCommitted = false;
    scan.exportLabels = null;
    scan.exportImageData = null;
    updatePreviewChrome();
    drawPreview(scan);
  }
}

function randomizePreviewColors() {
  if (!state.scan) return;
  const ids = CORE.collectLabelIds(state.scan.labels);
  state.scan.labelColors = CORE.createRandomPalette(ids);
  drawPreview(state.scan);
  updatePreviewChrome();
}

function commitPreviewEdits() {
  if (!state.scan || !state.scan.labelsEdited) return;
  const settings = settingsFromState();
  const components = CORE.buildComponentsFromLabels(
    state.scan.labels,
    state.scan.analysisWidth,
    state.scan.analysisHeight,
    settings.minSize,
  );
  state.scan.components = components;
  state.scan.labelsCommitted = true;
  state.scan.exportLabels = null;
  state.scan.exportImageData = null;
  state.statusKind = components.length ? "ok" : "error";
  state.statusText = components.length
    ? `Updated: ${components.length} element${components.length === 1 ? "" : "s"} ready to export.`
    : "No elements left after Update. Adjust fills or run Preview again.";
  updatePreviewChrome();
  const statusSpan = document.querySelector(".status span");
  if (statusSpan) statusSpan.textContent = state.statusText;
  const statusBox = document.querySelector(".status");
  if (statusBox) {
    statusBox.className = `status status-${state.statusKind}`;
  }
  const exportBtn = document.querySelector('[data-run="export"]');
  if (exportBtn) exportBtn.disabled = !components.length;

  if (components.length && state.embedded) {
    // Persist full-document bboxes so a later Preview can restore them.
    const aw = state.scan.analysisWidth || 1;
    const ah = state.scan.analysisHeight || 1;
    const fw = state.scan.width || aw;
    const fh = state.scan.height || ah;
    const fullComponents = components.map((component) => ({
      ...component,
      minX: Math.floor((component.minX * fw) / aw),
      minY: Math.floor((component.minY * fh) / ah),
      maxX: Math.max(
        Math.floor((component.minX * fw) / aw),
        Math.ceil(((component.maxX + 1) * fw) / aw) - 1,
      ),
      maxY: Math.max(
        Math.floor((component.minY * fh) / ah),
        Math.ceil(((component.maxY + 1) * fh) / ah) - 1,
      ),
    }));
    const data = DATA.buildSplitData({
      settings,
      components: fullComponents,
      meta: state.scan.meta || {},
      width: state.scan.width,
      height: state.scan.height,
      pluginVersion: META.version,
      exported: false,
    });
    state.latestSplitData = data;
    upsertDataLayer(data).catch(() => {
      // Best-effort persistence.
    });
  }
}

function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// Data-layer scripts are best-effort: they keep their own token and timer so a
// silent Photopea never leaves the panel in a working state.
function sendDataLayerScript(requestId, script, timeoutMs) {
  return new Promise((resolve) => {
    if (!state.embedded) {
      resolve(null);
      return;
    }
    const settle = (payload) => {
      if (!state.dataLayerWaits.has(requestId)) return;
      window.clearTimeout(state.dataLayerWaits.get(requestId).timer);
      state.dataLayerWaits.delete(requestId);
      resolve(payload);
    };
    const timer = window.setTimeout(() => settle(null), timeoutMs || 8000);
    state.dataLayerWaits.set(requestId, { timer, settle });
    try {
      postScript(script);
    } catch {
      settle(null);
    }
  });
}

async function upsertDataLayer(data) {
  const requestId = createRequestId();
  const jsonText = JSON.stringify(data, null, 2);
  const payload = await sendDataLayerScript(
    requestId,
    makeUpsertDataLayerScript({ requestId, jsonText }),
    15000,
  );
  return !!(payload && payload.ok);
}

async function requestDataLayerRead() {
  const requestId = createRequestId();
  const payload = await sendDataLayerScript(
    requestId,
    makeReadDataLayerScript(requestId),
    8000,
  );
  if (!payload || !payload.ok || !payload.found || !payload.jsonText) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload.jsonText);
    const validation = DATA.validateSplitData(parsed);
    return validation.ok ? parsed : null;
  } catch {
    return null;
  }
}

function applyRestoredSettings(data, sourceLabel) {
  const settings = DATA.applySettingsFromData(data);
  if (!settings) return false;
  state.alphaThreshold = settings.alphaThreshold;
  state.minSize = settings.minSize;
  state.prefix = settings.prefix;
  state.eightConnected = settings.eightConnected;
  state.latestSplitData = data;
  if (sourceLabel === "folder") state.folderData = data;
  state.statusKind = "ok";
  state.statusText = `Restored Alpha Split settings from ${sourceLabel}.`;
  return true;
}

async function readFolderSplitData() {
  if (!state.folderHandle || state.folderPermission !== "granted") return null;
  try {
    const fileHandle = await state.folderHandle.getFileHandle(DATA.DATA_FILENAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    const validation = DATA.validateSplitData(parsed);
    if (!validation.ok) return null;
    state.folderData = parsed;
    return parsed;
  } catch {
    state.folderData = null;
    return null;
  }
}

async function writeFolderSplitData(data) {
  const text = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(text);
  await writeFileToDirectory(DATA.DATA_FILENAME, bytes);
  state.folderData = data;
}

async function placeNextAssembleLayer(requestId) {
  const job = state._assembleJob;
  if (!job || state.activeRequestId !== requestId) return;

  if (job.index >= job.layers.length) {
    runAssembleBatchFinish(requestId);
    return;
  }

  const layer = job.layers[job.index];
  job.phase = "placing";
  job.captureRetries = 0;
  job.awaitingOpenDone = true;
  setWorking(
    "placing",
    `Importing ${job.index + 1} / ${job.layers.length}: ${layer.name}`,
    requestId,
    "assemble",
    job.timeoutMs,
  );
  render();

  try {
    postScript(
      makeAssembleOpenScript({ requestId, dataUrl: layer.dataUrl }),
    );
  } catch (error) {
    job.awaitingOpenDone = false;
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function captureAssembleLayer(requestId) {
  const job = state._assembleJob;
  if (!job || state.activeRequestId !== requestId) return;
  if (job.index >= job.layers.length) return;

  const layer = job.layers[job.index];
  job.phase = "capturing";
  setWorking(
    "capturing",
    `Recording ${job.index + 1} / ${job.layers.length}: ${layer.name}`,
    requestId,
    "assemble",
    job.timeoutMs,
  );
  render();

  try {
    postScript(
      makeAssembleCaptureScript({
        requestId,
        index: job.index,
        total: job.layers.length,
        name: layer.name,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function runAssembleBatchFinish(requestId) {
  const job = state._assembleJob;
  if (!job || state.activeRequestId !== requestId) return;

  if (!job.placements || !job.placements.length) {
    failActiveRequest("No Smart Objects were imported to position.");
    return;
  }

  job.phase = "batching";
  job.batchDone = false;
  setWorking(
    "batching",
    `Positioning ${job.placements.length} Smart Object${job.placements.length === 1 ? "" : "s"} in “${job.groupName}”…`,
    requestId,
    "assemble",
    job.timeoutMs,
  );
  render();

  try {
    postScript(
      makeAssembleBatchFinishScript({
        requestId,
        groupId: job.groupId,
        groupName: job.groupName,
        placements: job.placements,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function completeAssembleJob(placedCount) {
  const job = state._assembleJob;
  const groupName = (job && job.groupName) || "elements";
  const total = (job && job.layers && job.layers.length) || placedCount;
  clearActiveRequest();
  state.stage = "complete";
  state.statusKind = "ok";
  state.statusText = `Assembled ${placedCount || total} Smart Object${(placedCount || total) === 1 ? "" : "s"} in “${groupName}”.`;
  state._assembleJob = null;
  render();
}

function finishAssembleLayer(requestId) {
  // Legacy name kept for any stray callers; capture is the post-open step now.
  captureAssembleLayer(requestId);
}

async function beginAssemble() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;

  if (state.destination !== "folder") {
    state.statusKind = "error";
    state.statusText = "Switch destination to Folder to assemble exported PNGs.";
    render();
    return;
  }

  const ready = await ensureFolderPermission();
  if (!ready) {
    state.assembleAfterFolderChoice = true;
    return;
  }

  let data = state.folderData;
  if (!data) data = await readFolderSplitData();
  const validation = DATA.validateSplitData(data);
  if (!validation.ok || !data.elements.length) {
    state.statusKind = "error";
    state.statusText =
      "Export to a folder first (writes alpha-split-data.json).";
    render();
    return;
  }

  const requestId = createRequestId();
  const timeoutMs = Math.min(
    1200000,
    Math.max(META.requestTimeoutMs || 180000, 60000 + data.elements.length * 8000),
  );
  setWorking(
    "preparing",
    "Reading exported PNGs for Assemble…",
    requestId,
    "assemble",
    timeoutMs,
  );
  render();

  try {
    const layers = [];
    for (let index = 0; index < data.elements.length; index++) {
      if (state.activeRequestId !== requestId) return;
      const element = data.elements[index];
      setWorking(
        "preparing",
        `Loading ${index + 1} / ${data.elements.length}: ${element.filename}`,
        requestId,
        "assemble",
        timeoutMs,
      );
      render();

      let fileHandle;
      try {
        fileHandle = await state.folderHandle.getFileHandle(element.filename);
      } catch {
        throw new Error(`Missing exported file: ${element.filename}`);
      }
      const file = await fileHandle.getFile();
      const buffer = new Uint8Array(await file.arrayBuffer());
      const name = String(element.filename).replace(/\.png$/i, "");
      layers.push({
        name,
        dataUrl: bytesToDataUrl(buffer, "image/png"),
        x: Number(element.x) || 0,
        y: Number(element.y) || 0,
      });
      await yieldToUi();
    }

    const prefix =
      (data.settings && data.settings.prefix) || state.prefix || "element";
    const groupName = `${prefix}s`;
    state._assembleJob = {
      layers,
      index: 0,
      groupName,
      groupId: null,
      timeoutMs,
      phase: "ensure",
      captureRetries: 0,
      placements: [],
      batchDone: false,
      awaitingOpenDone: false,
    };

    setWorking(
      "ensuring group",
      `Preparing group “${groupName}”…`,
      requestId,
      "assemble",
      timeoutMs,
    );
    render();
    postScript(
      makeAssembleEnsureGroupScript({ requestId, groupName }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function observePreviewResize() {
  if (state.previewObserver) {
    state.previewObserver.disconnect();
    state.previewObserver = null;
  }
  const card = document.querySelector("#preview-card");
  if (!card || typeof ResizeObserver !== "function") return;
  state.previewObserver = new ResizeObserver(() => {
    if (state.scan) drawPreview(state.scan);
  });
  state.previewObserver.observe(card);
}

function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function pickStoredSplitData(meta, fullWidth, fullHeight) {
  const candidates = [state.latestSplitData, state.folderData].filter(Boolean);
  for (const data of candidates) {
    const validation = DATA.validateSplitData(data);
    if (!validation.ok || !data.elements || !data.elements.length) continue;
    const docW = Number(data.document && data.document.width) || 0;
    const docH = Number(data.document && data.document.height) || 0;
    if (docW && docH && (docW !== fullWidth || docH !== fullHeight)) continue;
    if (
      meta &&
      data.source &&
      data.source.layerId != null &&
      meta.layerId != null &&
      Number(data.source.layerId) !== Number(meta.layerId)
    ) {
      // Same document size but different layer — still allow if names match loosely.
      if (
        data.source.layerName &&
        meta.layerName &&
        data.source.layerName !== meta.layerName
      ) {
        continue;
      }
    }
    return data;
  }
  return null;
}

async function finishScanAnalysis(requestId, pngBuffer, meta) {
  if (state.activeRequestId !== requestId) return;

  const timeoutMs = operationTimeoutMs("scan", meta, 0);
  setWorking(
    "processing",
    "Detecting separate alpha regions…",
    requestId,
    "scan",
    timeoutMs,
  );
  render();

  const settings = settingsFromState();
  const validation = CORE.validateSettings(settings);
  if (!validation.ok) {
    failActiveRequest(validation.message);
    return;
  }

  try {
    // Preview uses a downscaled analysis image so 8K documents stay responsive.
    const decoded = await decodePng(pngBuffer, META.previewMaxSide || 2048);
    if (state.activeRequestId !== requestId) return;

    setWorking(
      "processing",
      decoded.scale < 0.999
        ? `Detecting regions at ${decoded.imageData.width}×${decoded.imageData.height} (from ${decoded.fullWidth}×${decoded.fullHeight})…`
        : `Detecting separate alpha regions at ${decoded.fullWidth}×${decoded.fullHeight}…`,
      requestId,
      "scan",
      timeoutMs,
    );
    render();
    await yieldToUi();

    const labeled = CORE.labelComponents(
      decoded.imageData,
      settings.alphaThreshold,
      settings.minSize,
      settings.eightConnected,
    );

    let labels = labeled.labels;
    let components = labeled.components;
    let restored = false;

    const stored = pickStoredSplitData(
      meta,
      decoded.fullWidth,
      decoded.fullHeight,
    );
    if (stored && labeled.components.length) {
      const matched = CORE.matchComponentsToElements(
        labeled.labels,
        labeled.components,
        stored.elements,
        decoded.imageData.width,
        decoded.imageData.height,
        Number(stored.document && stored.document.width) || decoded.fullWidth,
        Number(stored.document && stored.document.height) || decoded.fullHeight,
      );
      if (matched.matched > 0) {
        labels = matched.labels;
        components = CORE.buildComponentsFromLabels(
          labels,
          decoded.imageData.width,
          decoded.imageData.height,
          settings.minSize,
        );
        restored = components.length > 0;
      }
    }

    const labelIds = components.map((component) => component.id);

    state.sampledLabel = null;
    state.editTool = "sample";
    clearPreviewHover();
    state.scan = {
      imageData: decoded.imageData,
      labels,
      components,
      labelColors: CORE.createDefaultPalette(labelIds),
      labelsEdited: false,
      labelsCommitted: true,
      exportLabels: null,
      exportImageData: null,
      width: decoded.fullWidth,
      height: decoded.fullHeight,
      analysisWidth: decoded.imageData.width,
      analysisHeight: decoded.imageData.height,
      analysisScale: decoded.scale,
      pngBuffer,
      fullResReady: decoded.scale >= 0.999,
      meta,
      settings,
      restoredFromData: restored,
    };

    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = components.length ? "ok" : "error";
    const scaleNote =
      decoded.scale < 0.999
        ? " Preview used a downscaled pass; Export rebuilds at full resolution."
        : "";
    if (!components.length) {
      state.statusText =
        "No elements matched your thresholds. Lower alpha threshold or min pixels.";
    } else if (restored) {
      state.statusText = `Restored ${components.length} element${components.length === 1 ? "" : "s"} from Alpha Split data.${scaleNote}`;
    } else {
      state.statusText = `Preview ready: ${components.length} separate element${components.length === 1 ? "" : "s"} detected.${scaleNote}`;
    }
    render();
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function ensureFullResolutionScan(requestId, settings) {
  const scan = state.scan;
  if (!scan) throw new Error("Preview data is missing. Run Preview again.");

  if (scan.labelsEdited) {
    if (scan.exportLabels && scan.exportImageData && scan.labelsCommitted) {
      return {
        ...scan,
        imageData: scan.exportImageData,
        labels: scan.exportLabels,
        components: scan.components,
      };
    }
    if (!scan.pngBuffer) {
      throw new Error("Preview data is missing. Run Preview again.");
    }

    const timeoutMs = operationTimeoutMs(
      "export",
      scan.meta,
      scan.components.length,
    );
    setWorking(
      "preparing",
      "Propagating edited masks to full resolution…",
      requestId,
      "export",
      timeoutMs,
    );
    render();

    const decoded = await decodePng(scan.pngBuffer, 0);
    if (state.activeRequestId !== requestId) return null;
    await yieldToUi();

    const opaque = CORE.buildOpaqueMaskFromImageData(
      decoded.imageData,
      settings.alphaThreshold,
    );
    const fullLabels = CORE.propagateLabelsToFullRes(
      scan.labels,
      scan.analysisWidth,
      scan.analysisHeight,
      decoded.fullWidth,
      decoded.fullHeight,
      opaque,
    );
    const components = CORE.buildComponentsFromLabels(
      fullLabels,
      decoded.fullWidth,
      decoded.fullHeight,
      settings.minSize,
    );

    scan.exportImageData = decoded.imageData;
    scan.exportLabels = fullLabels;
    scan.components = components;
    scan.width = decoded.fullWidth;
    scan.height = decoded.fullHeight;

    return {
      ...scan,
      imageData: decoded.imageData,
      labels: fullLabels,
      components,
    };
  }

  if (scan.exportLabels && scan.exportImageData) {
    return {
      ...scan,
      imageData: scan.exportImageData,
      labels: scan.exportLabels,
      components: scan.components,
    };
  }

  // Analysis was already full resolution (no downscale).
  if (scan.fullResReady && scan.analysisScale >= 0.999) {
    return scan;
  }
  if (!scan.pngBuffer) {
    throw new Error("Preview data is missing. Run Preview again.");
  }

  const timeoutMs = operationTimeoutMs(
    "export",
    scan.meta,
    scan.components.length,
  );
  setWorking(
    "preparing",
    "Building full-resolution masks for Export…",
    requestId,
    "export",
    timeoutMs,
  );
  render();

  const decoded = await decodePng(scan.pngBuffer, 0);
  if (state.activeRequestId !== requestId) return null;

  setWorking(
    "preparing",
    "Detecting elements at full resolution…",
    requestId,
    "export",
    timeoutMs,
  );
  render();
  await yieldToUi();

  const labeled = CORE.labelComponents(
    decoded.imageData,
    settings.alphaThreshold,
    settings.minSize,
    settings.eightConnected,
  );

  // Preserve analysis labels for continued editing; export uses full-res copies.
  scan.exportImageData = decoded.imageData;
  scan.exportLabels = labeled.labels;
  scan.components = labeled.components;
  scan.width = decoded.fullWidth;
  scan.height = decoded.fullHeight;
  scan.fullResReady = true;
  scan.settings = settings;

  return {
    ...scan,
    imageData: decoded.imageData,
    labels: labeled.labels,
    components: labeled.components,
  };
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
  setWorking(
    "receiving snapshot",
    "Snapshotting the document (large files take a while)…",
    requestId,
    "scan",
  );
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

async function beginExport() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;
  if (!state.scan || !state.scan.components.length) {
    state.statusKind = "error";
    state.statusText = "Preview a layer before exporting.";
    render();
    return;
  }
  if (state.scan.labelsEdited && !state.scan.labelsCommitted) {
    state.statusKind = "error";
    state.statusText =
      "Click Update to apply preview edits before exporting.";
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

  if (
    state.scan.settings &&
    (state.scan.settings.alphaThreshold !== settings.alphaThreshold ||
      state.scan.settings.minSize !== settings.minSize ||
      !!state.scan.settings.eightConnected !== !!settings.eightConnected)
  ) {
    state.statusKind = "error";
    state.statusText =
      "Detection settings changed. Run Preview again before exporting.";
    render();
    return;
  }

  if (state.destination === "folder") {
    const ready = await ensureFolderPermission();
    if (!ready) {
      state.exportAfterFolderChoice = true;
      return;
    }
  }

  const requestId = createRequestId();
  const timeoutMs = operationTimeoutMs(
    "export",
    state.scan.meta,
    state.scan.components.length,
  );
  setWorking("preparing", "Preparing cropped PNG exports…", requestId, "export", timeoutMs);
  render();

  try {
    const scan = await ensureFullResolutionScan(requestId, settings);
    if (!scan || state.activeRequestId !== requestId) return;

    if (!scan.components.length) {
      failActiveRequest("No elements to export after Update.");
      return;
    }

    const zipEntries = [];
    const written = [];

    for (let index = 0; index < scan.components.length; index++) {
      if (state.activeRequestId !== requestId) return;
      const component = scan.components[index];
      const baseName = `${settings.prefix}_${padNumber(index + 1, 2)}`;
      const filename = `${baseName}.png`;
      setWorking(
        "exporting",
        `Exporting ${index + 1} / ${scan.components.length}: ${filename}`,
        requestId,
        "export",
        timeoutMs,
      );
      render();

      const crop = CORE.extractComponentCrop(
        scan.imageData,
        scan.labels,
        component,
      );
      const bytes = await imageDataToPngBytes(crop.imageData);

      if (state.destination === "folder") {
        written.push(await writeFileToDirectory(filename, bytes));
      } else {
        zipEntries.push({ name: filename, data: bytes });
        written.push(filename);
      }
      await yieldToUi();
    }

    if (state.activeRequestId !== requestId) return;

    const splitData = DATA.buildSplitData({
      settings,
      components: scan.components,
      meta: scan.meta || {},
      width: scan.width,
      height: scan.height,
      pluginVersion: META.version,
      exported: true,
    });
    state.latestSplitData = splitData;

    if (state.destination === "zip") {
      const jsonBytes = new TextEncoder().encode(
        JSON.stringify(splitData, null, 2),
      );
      zipEntries.push({ name: DATA.DATA_FILENAME, data: jsonBytes });
      const zipBlob = ZIP.createStoredZip(zipEntries);
      const zipName = `${settings.prefix}_elements.zip`;
      downloadBlob(zipBlob, zipName);
    } else {
      await writeFolderSplitData(splitData);
    }

    await upsertDataLayer(splitData);

    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = "ok";
    state.statusText =
      state.destination === "zip"
        ? `Downloaded ${written.length} PNG${written.length === 1 ? "" : "s"} and data JSON as ${settings.prefix}_elements.zip.`
        : `Exported ${written.length} PNG${written.length === 1 ? "" : "s"} and ${DATA.DATA_FILENAME} to “${state.folderName}”.`;
    render();
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
    "Exporting the isolated active layer as PNG…",
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

  setWorking(
    "cleaning up",
    "Closing the temporary copy and restoring the workfile…",
    requestId,
    "scan",
  );
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
  if (!state.activeRequestId) return;

  if (state.activeOperation === "assemble") {
    const job = state._assembleJob;
    if (!job) return;

    if (state.stage === "placing" && job.phase === "placing" && job.awaitingOpenDone) {
      // Open script finished; give Photopea a beat, then capture the new layer id.
      job.awaitingOpenDone = false;
      const indexAtOpen = job.index;
      window.setTimeout(() => {
        if (
          state.activeRequestId &&
          state.activeOperation === "assemble" &&
          state._assembleJob &&
          state._assembleJob.index === indexAtOpen &&
          (state.stage === "placing" || state.stage === "capturing")
        ) {
          captureAssembleLayer(state.activeRequestId);
        }
      }, 120);
      return;
    }

    if (state.stage === "batching" && job.phase === "batching" && !job.batchDone) {
      // Backup if assemble-batch echo was dropped.
      job.batchDone = true;
      completeAssembleJob(job.placements.length);
    }
    return;
  }

  if (state.activeOperation !== "scan") return;

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
  if (!payload) return;

  // Data-layer replies carry their own token and can arrive while idle.
  if (payload.type === "data-layer") {
    const wait = state.dataLayerWaits.get(payload.requestId);
    if (wait) wait.settle(payload);
    return;
  }

  if (!state.activeRequestId || payload.requestId !== state.activeRequestId) {
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

  if (payload.type === "assemble-group") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not create the assemble group.");
      return;
    }
    if (!state._assembleJob) return;
    state._assembleJob.groupId = payload.groupId;
    placeNextAssembleLayer(payload.requestId);
    return;
  }

  if (payload.type === "assemble-placed") {
    const job = state._assembleJob;
    if (!job) return;
    if (payload.notReady) {
      job.captureRetries = (job.captureRetries || 0) + 1;
      if (job.captureRetries > 8) {
        failActiveRequest(
          payload.message || "Smart Object did not finish loading in time.",
        );
        return;
      }
      window.setTimeout(() => {
        if (
          state.activeRequestId === payload.requestId &&
          state.activeOperation === "assemble"
        ) {
          captureAssembleLayer(payload.requestId);
        }
      }, 150 + job.captureRetries * 50);
      return;
    }
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not record a placed layer.");
      return;
    }
    const source = job.layers[payload.index];
    if (!source) {
      failActiveRequest("Assemble lost track of the imported layer list.");
      return;
    }
    job.placements.push({
      layerId: payload.layerId,
      name: source.name,
      x: source.x,
      y: source.y,
    });
    // Drop the heavy dataUrl once placed so memory stays reasonable.
    source.dataUrl = null;
    job.index = payload.index + 1;
    placeNextAssembleLayer(payload.requestId);
    return;
  }

  if (payload.type === "assemble-batch") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not position assembled layers.");
      return;
    }
    const job = state._assembleJob;
    if (job && job.batchDone) return;
    if (job) job.batchDone = true;
    completeAssembleJob(payload.placed || (job && job.placements.length) || 0);
    return;
  }

  if (payload.type === "assemble-progress") {
    // Older progress messages — treat success as batch complete / notReady as capture retry.
    if (payload.notReady) {
      const job = state._assembleJob;
      if (!job) return;
      job.captureRetries = (job.captureRetries || 0) + 1;
      if (job.captureRetries > 8) {
        failActiveRequest(
          payload.message || "Smart Object did not finish loading in time.",
        );
        return;
      }
      window.setTimeout(() => {
        if (
          state.activeRequestId === payload.requestId &&
          state.activeOperation === "assemble"
        ) {
          captureAssembleLayer(payload.requestId);
        }
      }, 150 + job.captureRetries * 50);
      return;
    }
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not assemble a layer.");
      return;
    }
    return;
  }

  if (payload.type === "assemble") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not assemble elements.");
      return;
    }
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
      if (button.dataset.run === "export") beginExport();
      if (button.dataset.run === "assemble") beginAssemble();
    });
  });

  document.querySelectorAll("[data-destination]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.destination;
      if (next !== "folder" && next !== "zip") return;
      state.destination = next;
      if (state.statusKind !== "working") {
        state.statusKind = "idle";
        state.statusText =
          next === "zip"
            ? "ZIP mode will download one archive of cropped PNGs."
            : state.folderName
              ? `Folder ready: “${state.folderName}”.`
              : "Choose an export folder, or switch to ZIP.";
      }
      render();
    });
  });

  document.querySelector("#choose-folder")?.addEventListener("click", () => {
    state.exportAfterFolderChoice = false;
    openFolderPicker(state.folderName ? "change" : "choose");
  });

  document
    .querySelector("#download-plugin")
    ?.addEventListener("click", downloadInstaller);

  document.querySelectorAll("[data-preview-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.previewAction;
      if (action === "randomize") {
        randomizePreviewColors();
        return;
      }
      if (action === "sample") {
        state.editTool = "sample";
        clearPreviewHover();
        updatePreviewChrome();
        if (state.scan) drawPreview(state.scan);
        return;
      }
      if (action === "fill") {
        state.editTool = "fill";
        clearPreviewHover();
        updatePreviewChrome();
        if (state.scan) drawPreview(state.scan);
        return;
      }
      if (action === "sample-new") {
        state.sampledLabel = "new";
        state.editTool = "fill";
        clearPreviewHover();
        updatePreviewChrome();
        if (state.scan) drawPreview(state.scan);
        return;
      }
      if (action === "update") {
        commitPreviewEdits();
      }
    });
  });

  document
    .querySelector("#preview-canvas")
    ?.addEventListener("click", handlePreviewClick);
  document
    .querySelector("#preview-canvas")
    ?.addEventListener("mousemove", schedulePreviewHover);
  document
    .querySelector("#preview-canvas")
    ?.addEventListener("mouseleave", handlePreviewMouseLeave);

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
      render();
    });
  });
}

async function handlePickerMessage(event) {
  if (event.origin !== window.location.origin || !event.data || !event.data.type) {
    return;
  }

  if (event.data.type === READY_MESSAGE) {
    if (event.data.handle) {
      state.folderHandle = event.data.handle;
      state.folderName = event.data.handle.name || event.data.name || "";
      try {
        await storeDirectoryHandle(event.data.handle);
      } catch {
        // Remembering is best-effort.
      }
    } else {
      await loadStoredDirectoryHandle();
    }
    state.folderPermission = "granted";
    state.statusKind = "ok";
    state.statusText = `Using “${state.folderName}” for direct exports.`;
    await readFolderSplitData();
    if (
      state.folderData &&
      (!state.latestSplitData || !state.latestSplitData.exported)
    ) {
      applyRestoredSettings(state.folderData, "folder");
    }
    render();

    if (state.exportAfterFolderChoice) {
      state.exportAfterFolderChoice = false;
      beginExport();
      return;
    }
    if (state.assembleAfterFolderChoice) {
      state.assembleAfterFolderChoice = false;
      beginAssemble();
    }
    return;
  }

  if (event.data.type === CANCEL_MESSAGE) {
    state.exportAfterFolderChoice = false;
    state.assembleAfterFolderChoice = false;
    state.statusKind = "error";
    state.statusText =
      event.data.reason === "unsupported"
        ? "Folder access is unavailable. Switch destination to ZIP."
        : "No export folder was selected.";
    render();
  }
}

window.addEventListener("message", (event) => {
  if (
    event.data &&
    typeof event.data === "object" &&
    (event.data.type === READY_MESSAGE || event.data.type === CANCEL_MESSAGE)
  ) {
    handlePickerMessage(event);
    return;
  }

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

function canRestoreSettings() {
  // Never overwrite inputs once the user has started working in this session.
  return !state.activeRequestId && !state.scan && state.stage === "idle";
}

async function restoreSavedSettings() {
  if (!canRestoreSettings()) return false;
  if (state.embedded) {
    const layerData = await requestDataLayerRead();
    if (!canRestoreSettings()) return false;
    if (layerData) {
      applyRestoredSettings(layerData, "document");
      render();
      return true;
    }
  }
  if (state.folderData) {
    applyRestoredSettings(state.folderData, "folder");
    render();
    return true;
  }
  return false;
}

async function bootstrapPanel() {
  // Paint first so the panel is usable even if storage or Photopea is slow.
  render();
  try {
    await loadStoredDirectoryHandle();
    if (state.folderPermission === "granted") {
      await readFolderSplitData();
    }
  } catch {
    // Folder memory is optional.
  }
  render();

  if (!state.embedded) {
    await restoreSavedSettings();
    return;
  }

  // Photopea may not accept scripts the instant the panel loads, so the silent
  // restore is deferred and retried once instead of holding the panel hostage.
  const attempt = async () => {
    if (await restoreSavedSettings()) return;
    window.setTimeout(() => {
      restoreSavedSettings().catch(() => {});
    }, 2500);
  };
  window.setTimeout(() => {
    attempt().catch(() => {});
  }, 400);
}

bootstrapPanel();
