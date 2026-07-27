"use strict";

const META = window.ALPHA_SPLIT_META;
const CORE = window.AlphaSplitCore;
const ZIP = window.AlphaSplitZip;
const RESULT_PREFIX = "ALPHA_SPLIT_RESULT::";
const MESSAGE_PREFIX = "ALPHA_SPLIT::";
const READY_MESSAGE = "ALPHA_SPLIT_DIRECTORY_READY";
const CANCEL_MESSAGE = "ALPHA_SPLIT_DIRECTORY_CANCELLED";
const DB_NAME = "photopea-alpha-split";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "export-directory";

if (!META || !CORE || !ZIP) {
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
  exportAfterFolderChoice: false,
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
        </div>
      </div>

      <footer class="panel-footer">
        <div class="panel-footer-copy">
          <span>Tested with Photopea ${escapeHtml(META.testedPhotopea)} · scripting v${escapeHtml(META.scriptingVersion)}</span>
          <span>Preview edits are local until Update · Export writes PNG files</span>
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
  const cardRect = card.getBoundingClientRect();
  const tipWidth = tip.offsetWidth || 120;
  const tipHeight = tip.offsetHeight || 24;
  let left = hover.tipX + 10;
  let top = hover.tipY + 10;
  left = Math.max(4, Math.min(left, cardRect.width - tipWidth - 4));
  top = Math.max(4, Math.min(top, cardRect.height - tipHeight - 4));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function drawIslandOutline(ctx, islandMask, analysisW, analysisH, scale, dw, dh) {
  const imageData = ctx.getImageData(0, 0, dw, dh);
  const dst = imageData.data;
  const isEdge = (sx, sy) => {
    const idx = sy * analysisW + sx;
    if (!islandMask[idx]) return false;
    if (sx === 0 || sy === 0 || sx === analysisW - 1 || sy === analysisH - 1) {
      return true;
    }
    return (
      !islandMask[idx - 1] ||
      !islandMask[idx + 1] ||
      !islandMask[idx - analysisW] ||
      !islandMask[idx + analysisW]
    );
  };

  for (let py = 0; py < dh; py++) {
    const srcY = Math.min(analysisH - 1, Math.floor(py / scale));
    for (let pxCol = 0; pxCol < dw; pxCol++) {
      const srcX = Math.min(analysisW - 1, Math.floor(pxCol / scale));
      if (!isEdge(srcX, srcY)) continue;
      const dstOffset = (py * dw + pxCol) << 2;
      dst[dstOffset] = 255;
      dst[dstOffset + 1] = 255;
      dst[dstOffset + 2] = 255;
      dst[dstOffset + 3] = 255;
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
  const containerWidth = Math.max(
    1,
    Math.floor((card && card.clientWidth) || canvas.clientWidth || 320),
  );
  const scale = Math.min(1, containerWidth / Math.max(width, 1));
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  if (canvas.width !== dw || canvas.height !== dh) {
    canvas.width = dw;
    canvas.height = dh;
  }
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(dw, dh);
  const src = imageData.data;
  const dst = out.data;
  const colors = scan.labelColors;

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
      scale,
      dw,
      dh,
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
  // Re-enable Export without full render when possible.
  const exportBtn = document.querySelector('[data-run="export"]');
  if (exportBtn) exportBtn.disabled = !components.length;
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

    const labeled = CORE.labelComponents(
      decoded.imageData,
      settings.alphaThreshold,
      settings.minSize,
      settings.eightConnected,
    );

    const labelIds = labeled.components.map((component) => component.id);

    state.sampledLabel = null;
    state.editTool = "sample";
    clearPreviewHover();
    state.scan = {
      imageData: decoded.imageData,
      labels: labeled.labels,
      components: labeled.components,
      labelColors: CORE.createDefaultPalette(labelIds),
      labelsEdited: false,
      labelsCommitted: true,
      exportLabels: null,
      exportImageData: null,
      width: decoded.fullWidth,
      height: decoded.fullHeight,
      analysisWidth: labeled.width,
      analysisHeight: labeled.height,
      analysisScale: decoded.scale,
      pngBuffer,
      fullResReady: decoded.scale >= 0.999,
      meta,
      settings,
    };

    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = labeled.components.length ? "ok" : "error";
    const scaleNote =
      decoded.scale < 0.999
        ? " Preview used a downscaled pass; Export rebuilds at full resolution."
        : "";
    state.statusText = labeled.components.length
      ? `Preview ready: ${labeled.components.length} separate element${labeled.components.length === 1 ? "" : "s"} detected.${scaleNote}`
      : "No elements matched your thresholds. Lower alpha threshold or min pixels.";
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

    if (state.destination === "zip") {
      const zipBlob = ZIP.createStoredZip(zipEntries);
      const zipName = `${settings.prefix}_elements.zip`;
      downloadBlob(zipBlob, zipName);
      clearActiveRequest();
      state.stage = "complete";
      state.statusKind = "ok";
      state.statusText = `Downloaded ${written.length} PNG${written.length === 1 ? "" : "s"} as ${zipName}.`;
      render();
      return;
    }

    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = "ok";
    state.statusText = `Exported ${written.length} PNG${written.length === 1 ? "" : "s"} to “${state.folderName}”.`;
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
    render();

    if (state.exportAfterFolderChoice) {
      state.exportAfterFolderChoice = false;
      beginExport();
    }
    return;
  }

  if (event.data.type === CANCEL_MESSAGE) {
    state.exportAfterFolderChoice = false;
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

loadStoredDirectoryHandle().finally(() => {
  render();
});
