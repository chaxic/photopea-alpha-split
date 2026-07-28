"use strict";

const META = window.ALPHA_SPLIT_META;
const CORE = window.AlphaSplitCore;
const ZIP = window.AlphaSplitZip;
const DATA = window.AlphaSplitData;
const RESULT_PREFIX = "ALPHA_SPLIT_RESULT::";
const MESSAGE_PREFIX = "ALPHA_SPLIT::";
const READY_MESSAGE = "ALPHA_SPLIT_DIRECTORY_READY";
const CANCEL_MESSAGE = "ALPHA_SPLIT_DIRECTORY_CANCELLED";
const JSON_READY_MESSAGE = "ALPHA_SPLIT_JSON_READY";
const DB_NAME = "photopea-alpha-split";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "export-directory";
// Each import step is one short script, so a stalled step should surface quickly
// instead of hiding behind a whole-job timeout.
const IMPORT_STEP_TIMEOUT_MS = 45000;
// Give Photopea time to finish placing before we try to leave Free Transform.
const IMPORT_CAPTURE_DELAY_MS = 400;
const IMPORT_CAPTURE_RETRIES = 24;

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
  // Shown in the Data card: which JSON is active and where it came from.
  dataFileName: "",
  dataFileSource: "",
  exportAfterFolderChoice: false,
  // "import" | "position" | null — action to resume once folder access is granted.
  afterFolderChoice: null,
  pickerWindow: null,
  editTool: "sample",
  sampledLabel: null,
  previewHover: null,
  previewHoverRaf: null,
  stage: "idle",
  statusKind: "idle",
  statusText: "",
  // Shown in the footer while detecting/loading folder JSON + ID mask.
  bootHint: "",
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

function dataFileIcon() {
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.8h7l3 3v11.4H5z"></path>
      <path d="M12 2.8v3h3M7.2 10.2h5.6M7.2 13h5.6"></path>
    </svg>`;
}

function statusCheckIcon() {
  return `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4.2 9.2l3.2 3.2 6.4-6.8"></path></svg>`;
}

function statusCrossIcon() {
  return `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 5l8 8M13 5L5 13"></path></svg>`;
}

function folderPathLabel() {
  if (!state.folderName) return "";
  return `…/${state.folderName}`;
}

function dataPathLabel() {
  const file = state.dataFileName || DATA.DATA_FILENAME;
  if (state.folderName) return `${state.folderName}/${file}`;
  return file;
}

function hasLoadedData() {
  return !!(
    state.dataFileName ||
    state.folderData ||
    (state.latestSplitData &&
      state.latestSplitData.elements &&
      state.latestSplitData.elements.length)
  );
}

function destinationHtml(disabled) {
  const hasFolder = !!state.folderName;
  const title = hasFolder ? state.folderName : "Export folder not selected";
  const pathLine = hasFolder
    ? folderPathLabel()
    : "Required — choose where PNG files and data are written";
  const cardClass = hasFolder
    ? "destination-card destination-required destination-ok"
    : "destination-card destination-required destination-missing";

  return `
    <p class="section-label">Destination <span class="required-star" title="Required">*</span></p>
    <div class="${cardClass}">
      <div class="destination-icon status-icon ${hasFolder ? "status-ok" : "status-empty"}">${
        hasFolder ? statusCheckIcon() : statusCrossIcon()
      }</div>
      <div class="destination-copy">
        <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
        <span class="path-line" title="${escapeHtml(pathLine)}">${escapeHtml(pathLine)}</span>
      </div>
      <button class="small-button" id="choose-folder" type="button"${disabled}>
        ${hasFolder ? "Change" : "Choose"}
      </button>
    </div>`;
}

function dataFileHtml(disabled) {
  const loaded = hasLoadedData();
  const title = loaded
    ? state.dataFileName || DATA.DATA_FILENAME
    : DATA.DATA_FILENAME;
  let subtitle;
  if (!loaded) {
    subtitle = `Not loaded — expected JSON file “${DATA.DATA_FILENAME}”`;
  } else if (state.dataFileSource === "folder" && state.folderName) {
    subtitle = dataPathLabel();
  } else if (state.dataFileSource === "file") {
    subtitle = dataPathLabel();
  } else if (state.dataFileSource === "document") {
    subtitle = "Loaded from document";
  } else if (state.folderName) {
    subtitle = dataPathLabel();
  } else {
    subtitle = title;
  }

  return `
    <p class="section-label">Data</p>
    <div class="destination-card data-card ${loaded ? "data-loaded" : "data-empty"}">
      <div class="destination-icon status-icon ${loaded ? "status-ok" : "status-empty"}">${
        loaded ? statusCheckIcon() : statusCrossIcon()
      }</div>
      <div class="destination-copy">
        <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
        <span class="path-line" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</span>
      </div>
      <button class="small-button" type="button" data-run="load-data-file"${disabled}>
        ${loaded ? "Change" : "Load"}
      </button>
    </div>`;
}

function sampleIndicatorHtml() {
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
  if (!state.scan || state.scan.schematic) return "";
  const sampleActive = state.editTool === "sample" ? " tool-active" : "";
  const fillActive = state.editTool === "fill" ? " tool-active" : "";
  const saveDisabled =
    disabled || !state.scan.components || !state.scan.components.length
      ? " disabled"
      : "";
  const dirty =
    state.scan.labelsEdited && !state.scan.labelsCommitted
      ? '<span class="preview-dirty">unsaved edits</span>'
      : "";

  return `
    <div class="preview-toolbar" role="toolbar" aria-label="ID Mask edit tools">
      <button type="button" class="tool-button" data-preview-action="randomize"${disabled}>Randomize colors</button>
      <button type="button" class="tool-button" data-preview-action="reassign"${disabled}>Reassign Elements</button>
      <button type="button" class="tool-button${sampleActive}" data-preview-action="sample"${disabled}>Sample</button>
      <button type="button" class="tool-button${fillActive}" data-preview-action="fill"${disabled}>Fill</button>
    </div>
    <div class="preview-toolbar-save">
      <button type="button" class="tool-button tool-button-wide" data-preview-action="save-data"${saveDisabled}>Save data</button>
    </div>
    <div class="sample-row">
      <div class="sample-indicator">${sampleIndicatorHtml()}</div>
      ${dirty}
    </div>`;
}

function panelHtml() {
  const busy = state.statusKind === "working";
  const disabled = busy ? " disabled" : "";
  const settingsMatch =
    !state.scan ||
    state.scan.schematic ||
    (!state.scan.settingsInvalidated &&
      state.scan.settings &&
      state.scan.settings.alphaThreshold === Number(state.alphaThreshold) &&
      state.scan.settings.minSize === Number(state.minSize) &&
      !!state.scan.settings.eightConnected === !!state.eightConnected);
  const canExport =
    !busy &&
    state.scan &&
    !state.scan.schematic &&
    state.scan.components.length > 0 &&
    settingsMatch &&
    !(state.scan.labelsEdited && !state.scan.labelsCommitted);
  const exportDisabled = canExport ? "" : " disabled";
  const canUseFolderElements =
    !busy &&
    state.destination === "folder" &&
    state.folderPermission === "granted" &&
    state.folderData &&
    state.folderData.elements &&
    state.folderData.elements.length > 0;
  const folderElementsDisabled = canUseFolderElements ? "" : " disabled";
  const count = state.scan ? state.scan.components.length : 0;
  const canRestoreMask = hasLoadedSplitData();
  const showPreview = !!(state.scan || canRestoreMask);

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

        ${destinationHtml(disabled)}
        ${dataFileHtml(disabled)}

        <div class="preview-wrap${showPreview ? " show" : ""}" id="preview-wrap">
          <div class="preview-title-row">
            <span>${state.scan && state.scan.schematic ? "Layout" : "ID Mask"}</span>
            <strong id="preview-count">${
              state.scan
                ? `${count} element${count === 1 ? "" : "s"}${state.scan.schematic ? " (schematic)" : ""}`
                : canRestoreMask
                  ? `${(state.latestSplitData || state.folderData).elements.length} elements loaded`
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
                ? state.scan.schematic
                  ? `Schematic from saved boxes · ${state.scan.width}×${state.scan.height}`
                  : `Click empty space to clear sample · Sample/Fill · ${state.scan.width}×${state.scan.height}${
                      state.scan.analysisScale < 0.999
                        ? ` · edit @ ${state.scan.analysisWidth}×${state.scan.analysisHeight}`
                        : ""
                    }`
                : state.bootHint
                  ? escapeHtml(state.bootHint)
                  : `Looking for ${DATA.DATA_FILENAME} in the destination folder when selected.`
            }
          </p>
        </div>

        <div class="panel-actions">
          <div class="status status-${state.statusKind}" role="status" aria-live="polite">
            ${statusIcon()}
            <span>${escapeHtml(state.statusText)}</span>
          </div>
          <div class="action-row">
            <button class="secondary" type="button" data-run="generate-mask"${disabled}>Generate ID Mask</button>
            <button class="primary" type="button" data-run="export"${exportDisabled}>Export elements</button>
          </div>
          <div class="action-row">
            <button class="secondary" type="button" data-run="import-elements"${folderElementsDisabled}>Import Elements</button>
            <button class="secondary" type="button" data-run="position-elements"${folderElementsDisabled}>Position Elements</button>
          </div>
        </div>
      </div>

      <footer class="panel-footer">
        <div class="panel-footer-copy">
          <span>Tested with Photopea ${escapeHtml(META.testedPhotopea)} · scripting v${escapeHtml(META.scriptingVersion)}</span>
          <span>Save data writes JSON + ID mask · Export writes element PNGs</span>
          <span class="boot-hint">${escapeHtml(state.bootHint || "Folder JSON is the source of truth.")}</span>
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
          <span>Folder export</span>
          <span>Import and position</span>
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
  // 8-connected stays on by default; the UI toggle was removed.

  if (
    state.scan &&
    (previous.alphaThreshold !== state.alphaThreshold ||
      previous.minSize !== state.minSize ||
      previous.eightConnected !== state.eightConnected)
  ) {
    // Settings changed — export blocked until a fresh ID Mask.
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
  // Import jobs hold a PNG data URL per pending element, so drop them with the request.
  state._importJob = null;
  state._positionJob = null;
  state._positionGroupName = null;
  state._exportAfterArtwork = null;
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

function pxHelperSource() {
  // Photopea UnitValue is {Ig:"UnitValue", n:<px>, aBA:"px"}. Direct property
  // access (.n / .as) has hung Position scripts after reading bounds. Extract the
  // number via JSON.stringify, which Photopea already uses successfully in echoToOE.
  return `
  function px(value) {
    if (typeof value === "number" && !isNaN(value)) return value;
    if (value == null) return 0;
    try {
      var raw = JSON.stringify(value);
      if (typeof raw === "string") {
        var m = raw.match(/"n"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)/);
        if (m) return Number(m[1]);
      }
    } catch (_) {}
    try {
      var text = String(value);
      var match = text.match(/-?\\d+(\\.\\d+)?/);
      if (match) return Number(match[0]);
    } catch (_) {}
    return 0;
  }`;
}

function positionHelpers() {
  // Keep Position scripts tiny. Full scanHelpers previously pulled in a lot of
  // unused walkers; Position only needs send + px + a name lookup.
  return `
  var messageTag = ${JSON.stringify(MESSAGE_PREFIX)};
  ${pxHelperSource()}
  function send(type, object) {
    object.type = type;
    object.requestId = settings && settings.requestId ? settings.requestId : object.requestId;
    app.echoToOE(messageTag + JSON.stringify(object));
  }
  function findPlacedLayerByName(container, wantedName) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "ArtLayer" && item.name === wantedName) return item;
      if (item.typename === "LayerSet") {
        var nested = findPlacedLayerByName(item, wantedName);
        if (nested) return nested;
      }
    }
    return null;
  }`;
}

function commonHelpers() {
  return `
  var resultTag = ${JSON.stringify(RESULT_PREFIX)};
  var messageTag = ${JSON.stringify(MESSAGE_PREFIX)};
  ${pxHelperSource()}
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
    // Walk .layers instead of .layerSets so nested recursion stays on solid API.
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename !== "LayerSet") continue;
      if (item.name === wantedName) return item;
      var nested = findLayerSetByName(item, wantedName);
      if (nested) return nested;
    }
    return null;
  }
  function commitActiveTransform() {
    // Prefer a soft commit. executeAction("commit") can abort Photopea's whole
    // script engine (try/catch does not always catch it), which left Import
    // stuck on "Naming…" with no import-placed echo.
    try {
      var layer = app.activeDocument.activeLayer;
      if (layer && layer.typename === "ArtLayer") layer.translate(0, 0);
      return true;
    } catch (_) {}
    return false;
  }
  function collectLayerIds(container, out) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      var id = layerId(item);
      if (id >= 0) out.push(id);
      if (item.typename === "LayerSet") collectLayerIds(item, out);
    }
    return out;
  }
  function isTextLayer(layer) {
    // Trust layer.kind when Photopea exposes it: probing textItem misreports pixel
    // layers in some builds, which would hide a freshly placed Smart Object.
    try {
      if (typeof LayerKind !== "undefined" && LayerKind.TEXT) {
        var kind = layer.kind;
        if (kind) return kind === LayerKind.TEXT;
      }
    } catch (_) {}
    try {
      return String(layer.textItem.contents || "").length > 0;
    } catch (_) {}
    return false;
  }
  function resolveGroup(documentRef, wantedId, wantedName) {
    var group = null;
    if (wantedId !== null && wantedId !== undefined && wantedId >= 0) {
      group = findLayerById(documentRef, wantedId);
    }
    if (!group || group.typename !== "LayerSet") {
      group = findLayerSetByName(documentRef, wantedName);
    }
    if (!group || group.typename !== "LayerSet") return null;
    return group;
  }
  // Photoshop/Photopea reject ElementPlacement.INSIDE with a LayerSet target, and the
  // failure can abort the whole script (try/catch does not always catch it), so move
  // relative to a child of the group and confirm the result.
  function moveIntoGroup(layer, group) {
    if (isInsideGroup(layer, group)) return true;
    var id = layerId(layer);
    var anchor = null;
    try {
      for (var i = 0; i < group.layers.length; i++) {
        if (layerId(group.layers[i]) !== id) {
          anchor = group.layers[i];
          break;
        }
      }
    } catch (_) {}

    if (anchor) {
      try { layer.move(anchor, ElementPlacement.PLACEBEFORE); } catch (_) {}
      if (isInsideGroup(layer, group)) return true;
      try { layer.move(anchor, ElementPlacement.PLACEAFTER); } catch (_) {}
      if (isInsideGroup(layer, group)) return true;
    } else {
      var temporary = null;
      try { temporary = group.artLayers.add(); } catch (_) { temporary = null; }
      if (temporary) {
        try { layer.move(temporary, ElementPlacement.PLACEBEFORE); } catch (_) {}
        try { temporary.remove(); } catch (_) {}
        if (isInsideGroup(layer, group)) return true;
      }
    }
    return false;
  }
  function isInsideGroup(layer, group) {
    var id = layerId(layer);
    if (!(id >= 0)) return false;
    try {
      for (var i = 0; i < group.layers.length; i++) {
        if (layerId(group.layers[i]) === id) return true;
      }
    } catch (_) {}
    try {
      return layerId(layer.parent) === layerId(group);
    } catch (_) {
      return false;
    }
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
  // Placed elements are pixel layers, so text layers with the same name are ignored.
  function findPlacedLayerByName(container, wantedName) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "ArtLayer" && item.name === wantedName && !isTextLayer(item)) {
        return item;
      }
      if (item.typename === "LayerSet") {
        var nested = findPlacedLayerByName(item, wantedName);
        if (nested) return nested;
      }
    }
    return null;
  }
  function layerText(layer) {
    try { return String(layer.textItem.contents || ""); } catch (_) { return ""; }
  }
  // A renamed data layer is still recognisable by its payload, so look inside text
  // layers before giving up on the stored settings.
  function findDataLayerByText(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "ArtLayer" && isTextLayer(item)) {
        var text = layerText(item);
        if (text.indexOf("alpha-split") >= 0 && text.indexOf("elements") >= 0) return item;
      }
      if (item.typename === "LayerSet") {
        var nested = findDataLayerByText(item);
        if (nested) return nested;
      }
    }
    return null;
  }
  function findDataLayer(documentRef, layerName) {
    var layer = findArtLayerByName(documentRef, layerName);
    if (layer && isTextLayer(layer)) return layer;
    return layer || findDataLayerByText(documentRef);
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
  function collectVisibility(container, out) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      var wasVisible = true;
      try { wasVisible = !!item.visible; } catch (_) {}
      out.push({ id: layerId(item), visible: wasVisible });
      if (item.typename === "LayerSet") collectVisibility(item, out);
    }
  }
  function applyVisibilityMap(container, map) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      var key = String(layerId(item));
      if (map[key] !== undefined) {
        try { item.visible = map[key]; } catch (_) {}
      }
      if (item.typename === "LayerSet") applyVisibilityMap(item, map);
    }
  }
  function restoreVisibility(container, list) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
      map[String(list[i].id)] = list[i].visible;
    }
    applyVisibilityMap(container, map);
  }
  function send(type, object) {
    object.type = type;
    object.requestId = settings && settings.requestId ? settings.requestId : object.requestId;
    app.echoToOE(messageTag + JSON.stringify(object));
  }`;
}

// Capture/Generate/Restore only need a small helper set. Import helpers (commit,
// moveIntoGroup, …) stay out of these scripts — Photopea's engine is older and a
// syntax error anywhere in the injected helpers aborts the whole script with a
// bare "done" and no echoToOE.
function scanHelpers() {
  return `
  var messageTag = ${JSON.stringify(MESSAGE_PREFIX)};
  ${pxHelperSource()}
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
  function collectVisibility(container, out) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      var wasVisible = true;
      try { wasVisible = !!item.visible; } catch (_) {}
      out.push({ id: layerId(item), visible: wasVisible });
      if (item.typename === "LayerSet") collectVisibility(item, out);
    }
  }
  function applyVisibilityMap(container, map) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      var key = String(layerId(item));
      if (map[key] !== undefined) {
        try { item.visible = map[key]; } catch (_) {}
      }
      if (item.typename === "LayerSet") applyVisibilityMap(item, map);
    }
  }
  function restoreVisibility(container, list) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
      map[String(list[i].id)] = list[i].visible;
    }
    applyVisibilityMap(container, map);
  }
  function send(type, object) {
    object.type = type;
    object.requestId = settings && settings.requestId ? settings.requestId : object.requestId;
    app.echoToOE(messageTag + JSON.stringify(object));
  }`;
}

// Data-layer read/write only — keep Import helpers out of these scripts.
function dataLayerHelpers() {
  return `
  var messageTag = ${JSON.stringify(MESSAGE_PREFIX)};
  function layerId(layer) {
    try { return Number(layer.id); } catch (_) { return -1; }
  }
  function isTextLayer(layer) {
    try {
      if (typeof LayerKind !== "undefined" && LayerKind.TEXT) {
        var kind = layer.kind;
        if (kind) return kind === LayerKind.TEXT;
      }
    } catch (_) {}
    try {
      return String(layer.textItem.contents || "").length > 0;
    } catch (_) {}
    return false;
  }
  function layerText(layer) {
    try { return String(layer.textItem.contents || ""); } catch (_) { return ""; }
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
  function findDataLayerByText(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var item = container.layers[i];
      if (item.typename === "ArtLayer" && isTextLayer(item)) {
        var text = layerText(item);
        if (text.indexOf("alpha-split") >= 0 && text.indexOf("elements") >= 0) return item;
      }
      if (item.typename === "LayerSet") {
        var nested = findDataLayerByText(item);
        if (nested) return nested;
      }
    }
    return null;
  }
  function findDataLayer(documentRef, layerName) {
    var layer = findArtLayerByName(documentRef, layerName);
    if (layer && isTextLayer(layer)) return layer;
    return layer || findDataLayerByText(documentRef);
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
  ${scanHelpers()}
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

// Restore already knows the element boxes, so it skips the PSD snapshot round trip
// and exports the isolated layer straight from the workfile, putting visibility back
// in the same script.
function makeLightCaptureScript(requestId) {
  return `
(function () {
  var settings = { requestId: ${JSON.stringify(requestId)} };
  ${scanHelpers()}
  var documentRef = null;
  var visibility = [];
  try {
    send("probe", { ok: true, step: "script-start" });
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open a document before restoring the ID mask.");
    }
    documentRef = app.activeDocument;
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
    collectVisibility(documentRef, visibility);
    hideEveryLayer(documentRef);
    revealWithParents(layer, documentRef);
    documentRef.saveToOE("png");
  } catch (error) {
    send("error", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
  if (documentRef && visibility.length) {
    try { restoreVisibility(documentRef, visibility); } catch (_) {}
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
  ${scanHelpers()}
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
  ${scanHelpers()}
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
  ${dataLayerHelpers()}
  try {
    send("probe", { ok: true, step: "upsert-start" });
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open a document before saving Alpha Split data.");
    }
    var documentRef = app.activeDocument;
    var layer = findDataLayer(documentRef, settings.layerName);
    send("probe", { ok: true, step: layer ? "upsert-found" : "upsert-create" });
    if (!layer) {
      // Do not set layer.kind outside try/catch — Photopea can abort the whole
      // script on an illegal kind change, which left Save data with JSON only.
      layer = documentRef.artLayers.add();
      try { layer.name = settings.layerName; } catch (_) {}
      try {
        if (typeof LayerKind !== "undefined" && LayerKind.TEXT) {
          layer.kind = LayerKind.TEXT;
        }
      } catch (_) {}
    } else {
      try { layer.name = settings.layerName; } catch (_) {}
      try {
        if (typeof LayerKind !== "undefined" && LayerKind.TEXT) {
          layer.kind = LayerKind.TEXT;
        }
      } catch (_) {}
    }
    send("probe", { ok: true, step: "upsert-write-text" });
    try {
      layer.textItem.contents = settings.jsonText;
    } catch (textError) {
      throw new Error("Could not write the Alpha Split data layer text.");
    }
    try { layer.visible = false; } catch (_) {}
    send("data-layer", { ok: true, written: true, layerName: settings.layerName });
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
  ${dataLayerHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      send("data-layer", { ok: true, found: false, jsonText: null });
      return;
    }
    var documentRef = app.activeDocument;
    var layer = findDataLayer(documentRef, settings.layerName);
    if (!layer) {
      send("data-layer", { ok: true, found: false, jsonText: null });
      return;
    }
    send("data-layer", { ok: true, found: true, jsonText: layerText(layer) });
  } catch (error) {
    send("data-layer", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeImportEnsureGroupScript({ requestId, groupName }) {
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
    // Baseline every existing layer so import can only ever claim layers it placed.
    send("import-group", {
      ok: true,
      groupId: layerId(group),
      groupName: settings.groupName,
      knownLayerIds: collectLayerIds(documentRef, [])
    });
  } catch (error) {
    send("import-group", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makeImportOpenScript({ requestId, dataUrl }) {
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
    send("import", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

// Import only claims and names the placed Smart Object. Position Elements does the
// moving later, keyed by these names, so a dropped echo can never lose placements.
function makeImportCaptureScript({
  requestId,
  index,
  total,
  name,
  knownLayerIds,
  groupId,
  groupName,
}) {
  const payload = JSON.stringify({
    requestId,
    index,
    total,
    name,
    knownLayerIds: knownLayerIds || [],
    groupId,
    groupName,
    dataLayerName: DATA.DATA_LAYER_NAME,
  });
  return `
(function () {
  var settings = ${payload};
  ${commonHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("The source document is no longer open.");
    }
    // Soft-dismiss Free Transform if Photopea left it open after place.
    // executeAction-based commits can abort the whole script with no echo.
    commitActiveTransform();
    send("probe", { ok: true, step: "naming-start", index: settings.index, name: settings.name });

    var documentRef = app.activeDocument;
    var known = {};
    var knownList = settings.knownLayerIds || [];
    for (var k = 0; k < knownList.length; k++) {
      var knownId = Number(knownList[k]);
      if (knownId >= 0) known[knownId] = true;
    }

    function isKnown(layer) {
      // Without usable layer ids nothing is "known"; naming rules still guard the claim.
      var id = layerId(layer);
      if (!(id >= 0)) return false;
      return !!known[id];
    }

    // Only untracked pixel layers may be claimed, so existing artwork and the data
    // layer can never be renamed or moved by an import.
    function isCandidate(layer) {
      if (!layer || layer.typename !== "ArtLayer") return false;
      if (isKnown(layer)) return false;
      if (isTextLayer(layer)) return false;
      return String(layer.name) !== settings.dataLayerName;
    }
    function isNamedForPlacement(layer) {
      var name = String(layer.name);
      return name === "image" || name === String(settings.name);
    }
    function collectCandidates(container, out) {
      for (var i = 0; i < container.layers.length; i++) {
        var item = container.layers[i];
        if (item.typename === "LayerSet") {
          collectCandidates(item, out);
          continue;
        }
        if (isCandidate(item)) out.push(item);
      }
      return out;
    }

    var candidates = [];
    var resultLayer = null;
    // Prefer the active layer first — a full stack walk can hang while Free Transform
    // is still modal after app.open(..., true).
    try {
      var activeFirst = documentRef.activeLayer;
      if (activeFirst && isCandidate(activeFirst) && isNamedForPlacement(activeFirst)) {
        resultLayer = activeFirst;
      }
    } catch (_) {}

    if (!resultLayer) {
      candidates = collectCandidates(documentRef, []);
      // Prefer a fresh "image" Smart Object over an already-named leftover.
      for (var c = 0; c < candidates.length; c++) {
        if (String(candidates[c].name) === "image") {
          resultLayer = candidates[c];
          break;
        }
      }
      if (!resultLayer) {
        for (var c2 = 0; c2 < candidates.length; c2++) {
          if (isNamedForPlacement(candidates[c2])) {
            resultLayer = candidates[c2];
            break;
          }
        }
      }
      if (!resultLayer && knownList.length > 0 && candidates.length === 1) {
        resultLayer = candidates[0];
      }
    }

    if (!resultLayer) {
      var unknownNames = [];
      for (var u = 0; u < candidates.length && u < 6; u++) {
        unknownNames.push(String(candidates[u].name));
      }
      send("import-placed", {
        ok: false,
        notReady: true,
        unknownNames: unknownNames,
        message: "Waiting for placed Smart Object “" + settings.name + "”."
      });
      return;
    }

    var expected = String(settings.name);
    // Already correctly named from a prior attempt — claim it and move on.
    if (String(resultLayer.name) === expected) {
      try { resultLayer.visible = true; } catch (_) {}
      send("import-placed", {
        ok: true,
        index: settings.index,
        total: settings.total,
        name: expected,
        grouped: false,
        layerId: layerId(resultLayer)
      });
      return;
    }

    send("probe", { ok: true, step: "naming-found", name: String(resultLayer.name) });

    // Free the expected name if a leftover unknown layer is sitting on it.
    try {
      var occupant = findArtLayerByName(documentRef, expected);
      if (occupant && occupant !== resultLayer && !isKnown(occupant)) {
        try { occupant.name = expected + "__prev"; } catch (_) {}
      }
    } catch (_) {}

    var renamed = false;
    try {
      resultLayer.name = expected;
      renamed = String(resultLayer.name) === expected;
    } catch (_) {
      renamed = false;
    }
    send("probe", { ok: true, step: "naming-renamed", renamed: renamed, name: String(resultLayer.name) });
    if (!renamed) {
      send("import-placed", {
        ok: false,
        message: "Photopea would not rename the placed layer to “" + expected +
          "” (got “" + String(resultLayer.name) + "”)."
      });
      return;
    }

    // Do not moveIntoGroup here — PLACE* while Free Transform is open can hang
    // the script with no echo. Position Elements groups and places by name.
    try { resultLayer.visible = true; } catch (_) {}
    try { documentRef.activeLayer = resultLayer; } catch (_) {}

    send("import-placed", {
      ok: true,
      index: settings.index,
      total: settings.total,
      name: expected,
      grouped: false,
      layerId: layerId(resultLayer)
    });
  } catch (error) {
    send("import", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

// Photopea UnitValue host objects hang if .n / .as are read inside a script, and
// in-script JSON.stringify+regex px() was returning 0. echoToOE can serialize the
// raw UnitValue; panel JS parses .n. Measure and apply are therefore split.
function unitValueToNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && value.n != null) {
    const n = Number(value.n);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function makePositionMeasureScript({ requestId, index, total, name }) {
  const payload = JSON.stringify({ requestId, index, total, name });
  return `
(function () {
  var settings = ${payload};
  ${positionHelpers()}
  try {
    send("probe", {
      ok: true,
      step: "position-measure-start",
      index: settings.index,
      name: settings.name
    });
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open the document that holds the imported elements.");
    }
    var documentRef = app.activeDocument;
    var target = findPlacedLayerByName(documentRef, settings.name);
    if (!target) {
      send("position-measure", {
        ok: true,
        index: settings.index,
        name: settings.name,
        found: false
      });
      return;
    }
    try { target.visible = true; } catch (_) {}
    // Do NOT set activeLayer — activating a placed Smart Object can open Free
    // Transform and hang Photopea. Echo raw bounds; panel parses UnitValue.n.
    var bounds = target.bounds;
    send("position-measure", {
      ok: true,
      index: settings.index,
      name: settings.name,
      found: true,
      bounds: bounds ? [bounds[0], bounds[1], bounds[2], bounds[3]] : null
    });
  } catch (error) {
    send("position-measure", {
      ok: false,
      index: settings.index,
      name: settings.name,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

function makePositionApplyScript({
  requestId,
  index,
  total,
  name,
  scaleX,
  scaleY,
  doResize,
  dx,
  dy,
}) {
  const payload = JSON.stringify({
    requestId,
    index,
    total,
    name,
    scaleX,
    scaleY,
    doResize: !!doResize,
    dx,
    dy,
  });
  return `
(function () {
  var settings = ${payload};
  ${positionHelpers()}
  try {
    send("probe", {
      ok: true,
      step: "position-apply-start",
      index: settings.index,
      name: settings.name
    });
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open the document that holds the imported elements.");
    }
    var documentRef = app.activeDocument;
    var target = findPlacedLayerByName(documentRef, settings.name);
    if (!target) {
      send("position-apply", {
        ok: true,
        index: settings.index,
        name: settings.name,
        found: false
      });
      return;
    }
    try { target.visible = true; } catch (_) {}

    var resized = false;
    if (settings.doResize) {
      try {
        target.resize(
          Number(settings.scaleX),
          Number(settings.scaleY),
          AnchorPosition.TOPLEFT
        );
        resized = true;
      } catch (_) {}
    }

    var dx = Number(settings.dx) || 0;
    var dy = Number(settings.dy) || 0;
    if (dx !== 0 || dy !== 0) target.translate(dx, dy);

    // Echo raw after-bounds for panel logging only — no in-script px / corrective move.
    var after = null;
    try { after = target.bounds; } catch (_) {}
    send("position-apply", {
      ok: true,
      index: settings.index,
      name: settings.name,
      found: true,
      resized: resized,
      dx: dx,
      dy: dy,
      afterBounds: after ? [after[0], after[1], after[2], after[3]] : null
    });
  } catch (error) {
    send("position-apply", {
      ok: false,
      index: settings.index,
      name: settings.name,
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
      "The folder window was blocked. Allow pop-ups for this plugin, then choose a folder.";
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
  const comps = state.scan && state.scan.components;
  if (comps && comps.length) {
    const index = comps.findIndex((component) => component.id === labelId);
    if (index >= 0) {
      return `${state.prefix}_${padNumber(index + 1, 2)}`;
    }
  }
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
    outlineRadius: 1,
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
) {
  const imageData = ctx.getImageData(0, 0, dw, dh);
  const dst = imageData.data;

  const inIsland = (sx, sy) => {
    if (sx < 0 || sy < 0 || sx >= analysisW || sy >= analysisH) return false;
    return !!islandMask[sy * analysisW + sx];
  };

  // Thin 1px canvas-space outline (no circular stamp — that looked blobbed
  // when analysis pixels map to many preview pixels).
  for (let py = 0; py < dh; py++) {
    for (let pxCol = 0; pxCol < dw; pxCol++) {
      const srcX = Math.min(analysisW - 1, Math.floor(pxCol * scaleX));
      const srcY = Math.min(analysisH - 1, Math.floor(py * scaleY));
      if (!inIsland(srcX, srcY)) continue;
      const neighbors = [
        [pxCol + 1, py],
        [pxCol - 1, py],
        [pxCol, py + 1],
        [pxCol, py - 1],
      ];
      let edge = false;
      for (let n = 0; n < neighbors.length; n++) {
        const nx = neighbors[n][0];
        const ny = neighbors[n][1];
        if (nx < 0 || ny < 0 || nx >= dw || ny >= dh) {
          edge = true;
          break;
        }
        const nSrcX = Math.min(analysisW - 1, Math.floor(nx * scaleX));
        const nSrcY = Math.min(analysisH - 1, Math.floor(ny * scaleY));
        if (!inIsland(nSrcX, nSrcY)) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
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

  if (state.previewHover && state.previewHover.islandMask) {
    drawIslandOutline(
      ctx,
      state.previewHover.islandMask,
      width,
      height,
      layout.scaleX,
      layout.scaleY,
      layout.dw,
      layout.dh,
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
  const updateBtn = document.querySelector('[data-preview-action="save-data"]');
  if (updateBtn) {
    updateBtn.disabled = !(
      state.scan &&
      state.scan.components &&
      state.scan.components.length
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

  const island = CORE.floodIsland(
    scan.labels,
    scan.analysisWidth,
    scan.analysisHeight,
    coords.x,
    coords.y,
    state.eightConnected,
  );
  hover.islandMask = island.mask;

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

  if (!label) {
    // Empty space clears the sample swatch (replaces the old New button).
    state.sampledLabel = null;
    updatePreviewChrome();
    return;
  }

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
    scan.components = CORE.buildComponentsFromLabels(
      scan.labels,
      scan.analysisWidth,
      scan.analysisHeight,
      Number(state.minSize) || 1,
    );
    scan.labelsEdited = true;
    scan.labelsCommitted = false;
    // Keep exportLabels as the full-res opaque silhouette so Save can
    // propagate analysis edits without nearest-neighbour upscale aliasing.
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

function reassignElementsAction() {
  if (!state.scan || state.scan.schematic || !state.scan.imageData) return;
  if (state.statusKind === "working") return;
  readInputs();
  const settings = settingsFromState();
  const labeled = CORE.labelComponents(
    state.scan.imageData,
    settings.alphaThreshold,
    settings.minSize,
    settings.eightConnected,
  );
  state.scan.labels = labeled.labels;
  state.scan.components = labeled.components;
  state.scan.labelColors = CORE.createRandomPalette(
    labeled.components.map((component) => component.id),
  );
  state.scan.labelsEdited = true;
  state.scan.labelsCommitted = false;
  // Keep exportLabels as opaque guide for full-res Save/Export propagate.
  state.scan.exportImageData = null;
  state.scan.settings = settings;
  state.sampledLabel = null;
  clearPreviewHover();
  state.statusKind = labeled.components.length ? "ok" : "error";
  state.statusText = labeled.components.length
    ? `Reassigned ${labeled.components.length} element${
        labeled.components.length === 1 ? "" : "s"
      } from alpha (preview resolution).`
    : "No elements matched your thresholds after reassign.";
  updatePreviewChrome();
  drawPreview(state.scan);
  const status = document.querySelector(".status span");
  if (status) status.textContent = state.statusText;
  const statusEl = document.querySelector(".status");
  if (statusEl) {
    statusEl.className = `status status-${state.statusKind}`;
  }
}

function snapshotOpaqueFromLabels(labels, width, height) {
  if (!labels || labels.length !== width * height) return null;
  const opaque = new Uint8Array(width * height);
  for (let i = 0; i < opaque.length; i++) {
    opaque[i] = labels[i] ? 1 : 0;
  }
  return opaque;
}

function downscaleLabelsNearest(fullLabels, fullW, fullH, analysisW, analysisH) {
  const out = new Int32Array(analysisW * analysisH);
  for (let y = 0; y < analysisH; y++) {
    const srcY = Math.min(fullH - 1, Math.floor((y * fullH) / analysisH));
    for (let x = 0; x < analysisW; x++) {
      const srcX = Math.min(fullW - 1, Math.floor((x * fullW) / analysisW));
      out[y * analysisW + x] = fullLabels[srcY * fullW + srcX];
    }
  }
  return out;
}

function resolveFullResLabelsForSave(scan, settings, opaqueGuide) {
  // Prefer an untouched full-res mask when edits have not invalidated it.
  if (scan.exportLabels && !scan.labelsEdited) {
    return scan.exportLabels;
  }
  if (
    !scan.labels ||
    !scan.width ||
    !scan.height ||
    !scan.analysisWidth ||
    !scan.analysisHeight
  ) {
    return null;
  }
  if (
    scan.analysisScale >= 0.999 ||
    (scan.analysisWidth === scan.width && scan.analysisHeight === scan.height)
  ) {
    return scan.labels;
  }

  const aw = scan.analysisWidth;
  const ah = scan.analysisHeight;
  const fw = scan.width;
  const fh = scan.height;
  let opaque = opaqueGuide || null;

  // Prefer the previous full-res label silhouette (keeps true alpha edges).
  // IMPORTANT: snapshot this BEFORE compacting — compact used to zero merged-away
  // ids in exportLabels, which punched holes and made filled elements vanish.
  if (!opaque && scan.exportLabels && scan.exportLabels.length === fw * fh) {
    opaque = snapshotOpaqueFromLabels(scan.exportLabels, fw, fh);
  } else if (!opaque && scan.exportImageData && scan.exportImageData.width === fw) {
    opaque = CORE.buildOpaqueMaskFromImageData(
      scan.exportImageData,
      (settings && settings.alphaThreshold) || state.alphaThreshold || 8,
    );
  } else if (!opaque && scan.imageData && scan.imageData.width === fw) {
    opaque = CORE.buildOpaqueMaskFromImageData(
      scan.imageData,
      (settings && settings.alphaThreshold) || state.alphaThreshold || 8,
    );
  }

  if (opaque) {
    return CORE.propagateLabelsToFullRes(
      scan.labels,
      aw,
      ah,
      fw,
      fh,
      opaque,
    );
  }

  // Last resort (no full-res silhouette): nearest-neighbour — expect aliasing.
  const fullLabels = new Int32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    const sy = Math.min(ah - 1, Math.floor((y * ah) / fh));
    for (let x = 0; x < fw; x++) {
      const sx = Math.min(aw - 1, Math.floor((x * aw) / fw));
      fullLabels[y * fw + x] = scan.labels[sy * aw + sx];
    }
  }
  return fullLabels;
}

function compactScanLabelIds(scan, minSize) {
  if (!scan || !scan.labels) return;
  const result = CORE.compactLabelIds(
    scan.labels,
    scan.analysisWidth,
    scan.analysisHeight,
    minSize || 1,
    scan.labelColors,
  );
  scan.components = result.components;
  scan.labelColors = result.labelColors;
  // Do NOT remap/zero exportLabels here. Merged-away ids must stay non-zero in
  // the silhouette until propagate rewrites the full-res mask from analysis.
  if (typeof state.sampledLabel === "number" && result.remap.has(state.sampledLabel)) {
    state.sampledLabel = result.remap.get(state.sampledLabel);
  } else if (typeof state.sampledLabel === "number") {
    state.sampledLabel = null;
  }
}

function syncPreviewFromFullLabels(scan, fullLabels, minSize) {
  if (!scan || !fullLabels) return;
  scan.exportLabels = fullLabels;
  const aw = scan.analysisWidth;
  const ah = scan.analysisHeight;
  if (aw === scan.width && ah === scan.height) {
    scan.labels = fullLabels;
  } else {
    scan.labels = downscaleLabelsNearest(
      fullLabels,
      scan.width,
      scan.height,
      aw,
      ah,
    );
  }
  scan.components = CORE.buildComponentsFromLabels(
    scan.labels,
    aw,
    ah,
    minSize || 1,
  );
  scan.imageData = CORE.imageDataFromLabels(scan.labels, aw, ah);
  scan.labelsEdited = false;
  scan.labelsCommitted = true;
}

async function saveSplitDataAction() {
  if (!state.scan || state.scan.schematic) return;
  if (state.statusKind === "working") return;

  readInputs();
  const settings = settingsFromState();


  // Snapshot the full-res silhouette BEFORE compacting analysis ids. Compact used
  // to zero merged-away ids in exportLabels, which deleted those regions on Save.
  const opaqueGuide = snapshotOpaqueFromLabels(
    state.scan.exportLabels,
    state.scan.width,
    state.scan.height,
  );
  const previewCountBefore = state.scan.components
    ? state.scan.components.length
    : 0;

  compactScanLabelIds(state.scan, settings.minSize);
  if (state.scan.labelsEdited) {
    state.scan.labelsCommitted = true;
    state.scan.exportImageData = null;
  }

  if (!state.scan.components.length) {
    state.statusKind = "error";
    state.statusText =
      state.scan.labelsEdited
        ? "No elements left after edits. Adjust fills or run Generate ID Mask again."
        : "Generate or Restore an ID Mask before saving data.";
    updatePreviewChrome();
    render();
    return;
  }

  if (state.folderPermission !== "granted" || !state.folderHandle) {
    state.afterFolderChoice = "save-data";
    state.statusKind = "idle";
    state.statusText = "Choose an export folder, then Save data again.";
    render();
    openFolderPicker(state.folderName ? "change" : "choose");
    return;
  }

  const fullLabels = resolveFullResLabelsForSave(
    state.scan,
    settings,
    opaqueGuide,
  );
  if (!fullLabels) {
    state.statusKind = "error";
    state.statusText = "Could not build a full-resolution ID mask to save.";
    render();
    return;
  }
  // Full-res boxes for JSON / Position (avoids scaled preview-box error).
  const fullComponents = CORE.buildComponentsFromLabels(
    fullLabels,
    state.scan.width,
    state.scan.height,
    settings.minSize,
  );
  if (!fullComponents.length) {
    state.statusKind = "error";
    state.statusText =
      "No elements left after edits. Adjust fills or run Generate ID Mask again.";
    render();
    return;
  }
  const data = DATA.buildSplitData({
    settings,
    components: fullComponents,
    meta: state.scan.meta || {},
    width: state.scan.width,
    height: state.scan.height,
    pluginVersion: META.version,
    exported: false,
    labelColors: state.scan.labelColors,
  });
  state.latestSplitData = data;
  syncPreviewFromFullLabels(state.scan, fullLabels, settings.minSize);

  setWorking(
    "saving data",
    `Saving ${DATA.DATA_FILENAME} + ${DATA.ID_MASK_FILENAME}…`,
    createRequestId(),
    "save-data",
    60000,
  );
  render();

  try {
    await writeFolderSplitData(data);
    await writeIdMaskFile(fullLabels, state.scan.width, state.scan.height, null);
    clearActiveRequest();
    state.stage = "complete";
    state.statusKind = "ok";
    state.statusText = `Saved ${data.elements.length} element${data.elements.length === 1 ? "" : "s"} to “${state.folderName}/${DATA.DATA_FILENAME}” + ${DATA.ID_MASK_FILENAME}.`;
    render();
  } catch (error) {
    clearActiveRequest();
    state.stage = "error";
    state.statusKind = "error";
    state.statusText =
      error && error.message
        ? `Could not write data files: ${error.message}`
        : `Could not write ${DATA.DATA_FILENAME} / ${DATA.ID_MASK_FILENAME}.`;
    render();
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

function hasLoadedSplitData() {
  const data = state.latestSplitData || state.folderData;
  const validation = DATA.validateSplitData(data);
  return !!(validation.ok && data.elements && data.elements.length);
}

function buildSchematicScan(data) {
  const fullWidth = Math.max(
    1,
    Number(data.document && data.document.width) || 1024,
  );
  const fullHeight = Math.max(
    1,
    Number(data.document && data.document.height) || 1024,
  );
  const maxSide = META.previewMaxSide || 2048;
  const scale = Math.min(1, maxSide / Math.max(fullWidth, fullHeight));
  const aw = Math.max(1, Math.round(fullWidth * scale));
  const ah = Math.max(1, Math.round(fullHeight * scale));
  const imageData = new ImageData(aw, ah);
  const opaque = new Uint8Array(aw * ah);
  opaque.fill(1);
  const painted = CORE.labelsFromElements(
    aw,
    ah,
    opaque,
    data.elements,
    fullWidth,
    fullHeight,
  );
  const dst = imageData.data;
  for (let i = 0; i < painted.labels.length; i++) {
    if (!painted.labels[i]) continue;
    const o = i << 2;
    dst[o] = 255;
    dst[o + 1] = 255;
    dst[o + 2] = 255;
    dst[o + 3] = 255;
  }
  const components = CORE.buildComponentsFromLabels(painted.labels, aw, ah, 1);
  const labelIds = components.map((c) => c.id);
  return {
    imageData,
    labels: painted.labels,
    components,
    labelColors: paletteFromData(data, labelIds),
    labelsEdited: false,
    labelsCommitted: true,
    exportLabels: null,
    exportImageData: null,
    width: fullWidth,
    height: fullHeight,
    analysisWidth: aw,
    analysisHeight: ah,
    analysisScale: scale,
    pngBuffer: null,
    fullResReady: false,
    meta: data.source || {},
    settings: DATA.applySettingsFromData(data),
    restoredFromData: true,
    schematic: true,
  };
}

async function applyLoadedSplitData(data, sourceLabel) {
  const validation = DATA.validateSplitData(data);
  if (!validation.ok) {
    state.statusKind = "error";
    state.statusText = validation.message;
    state.bootHint = "Data file invalid.";
    return false;
  }
  applyRestoredSettings(data, sourceLabel);
  state.latestSplitData = data;
  if (sourceLabel === "folder" || sourceLabel === "file") {
    state.folderData = data;
  }
  state.dataFileName = DATA.DATA_FILENAME;
  state.dataFileSource = sourceLabel;
  state.sampledLabel = null;
  state.editTool = "sample";
  clearPreviewHover();

  const n = data.elements.length;
  const folderLabel = state.folderName ? `“${state.folderName}”` : "folder";
  state.bootHint = `Found ${DATA.DATA_FILENAME} (${n} elements). Restoring ID mask…`;
  state.statusKind = "ok";
  state.statusText = `Loaded ${n} element${n === 1 ? "" : "s"} from ${sourceLabel}. Restoring ID mask…`;
  render();

  // Prefer the exported mask file so the panel shows real shapes, not boxes.
  if (state.folderHandle && state.folderPermission === "granted") {
    try {
      const ok = await restoreIdMaskFromFolder();
      if (ok) {
        state.bootHint = `Loaded ${DATA.DATA_FILENAME} + ${DATA.ID_MASK_FILENAME} from ${folderLabel}.`;
        state.statusKind = "ok";
        state.statusText = `Restored ${state.scan.components.length} element${state.scan.components.length === 1 ? "" : "s"} from the export folder.`;
        return true;
      }
    } catch (_) {
      // Fall through to schematic layout.
    }
  }

  state.scan = buildSchematicScan(data);
  state.bootHint = `Loaded ${DATA.DATA_FILENAME}; ${DATA.ID_MASK_FILENAME} not found — schematic boxes only.`;
  state.statusKind = "ok";
  state.statusText = `Loaded ${n} element${n === 1 ? "" : "s"} from ${sourceLabel}. Export again if the ID mask file is missing.`;
  return true;
}

function makeReadActiveTextLayerScript(requestId) {
  const payload = JSON.stringify({ requestId });
  return `
(function () {
  var settings = ${payload};
  ${dataLayerHelpers()}
  try {
    if (!app.documents || app.documents.length === 0) {
      throw new Error("Open a document first.");
    }
    var layer = app.activeDocument.activeLayer;
    if (!layer) throw new Error("Select a text layer that holds Alpha Split data.");
    var text = "";
    try { text = String(layer.textItem.contents || ""); } catch (_) {
      throw new Error("Select a text layer that holds Alpha Split data.");
    }
    send("data-layer", { ok: true, found: true, jsonText: text, fromActive: true });
  } catch (error) {
    send("data-layer", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

async function loadDataLayerFromSelection() {
  if (!state.embedded) {
    state.statusKind = "error";
    state.statusText = "Install the plugin to load a data layer inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;
  const requestId = createRequestId();
  const payload = await sendDataLayerScript(
    requestId,
    makeReadActiveTextLayerScript(requestId),
    8000,
  );
  if (!payload || !payload.ok || !payload.jsonText) {
    state.statusKind = "error";
    state.statusText =
      (payload && payload.message) ||
      "Select the AlphaSplit Data text layer, then click Load data layer.";
    render();
    return;
  }
  try {
    const parsed = JSON.parse(payload.jsonText);
    applyLoadedSplitData(parsed, "document");
    render();
  } catch {
    state.statusKind = "error";
    state.statusText =
      "The selected layer does not contain valid Alpha Split JSON.";
    render();
  }
}

async function loadDataFileFromFolderOrPicker() {
  if (state.statusKind === "working") return;
  // Always open a file picker — folder auto-load happens on panel open / folder grant.
  openJsonFilePicker();
}

function openJsonFilePicker() {
  const url = new URL("./picker.html", pluginBaseUrl());
  url.searchParams.set("mode", "json");
  url.searchParams.set("v", META.version);
  const width = 420;
  const height = 360;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2),
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2),
  );
  state.pickerWindow = window.open(
    url.href,
    "alpha-split-json-picker",
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!state.pickerWindow) {
    state.statusKind = "error";
    state.statusText =
      "Popup blocked. Allow popups for this site, or grant folder access and try again.";
    render();
  }
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
  state.dataFileName = DATA.DATA_FILENAME;
  if (state.folderName) state.dataFileSource = "folder";
}

async function readFolderIdMaskBytes() {
  if (!state.folderHandle || state.folderPermission !== "granted") return null;
  try {
    const name =
      (state.latestSplitData && state.latestSplitData.idMask) ||
      (state.folderData && state.folderData.idMask) ||
      DATA.ID_MASK_FILENAME;
    const fileHandle = await state.folderHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

function paletteFromData(data, labelIds) {
  const stored = DATA.parseLabelColors(data && data.labelColors);
  const fallback = CORE.createDefaultPalette(labelIds);
  const colors = new Map();
  for (let i = 0; i < labelIds.length; i++) {
    const id = labelIds[i];
    colors.set(id, stored.get(id) || fallback.get(id));
  }
  return colors;
}

function buildScanFromIdMaskLabels(labels, width, height, data) {
  const settings = DATA.applySettingsFromData(data) || settingsFromState();
  const minSize = settings.minSize || 1;
  const components = CORE.buildComponentsFromLabels(
    labels,
    width,
    height,
    minSize,
  );
  const labelIds = components.map((c) => c.id);
  const imageData = CORE.imageDataFromLabels(labels, width, height);
  const maxSide = META.previewMaxSide || 2048;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  let analysisLabels = labels;
  let analysisImage = imageData;
  let analysisW = width;
  let analysisH = height;
  let analysisScale = 1;

  if (scale < 0.999) {
    analysisW = Math.max(1, Math.round(width * scale));
    analysisH = Math.max(1, Math.round(height * scale));
    analysisScale = scale;
    // Nearest-neighbour downscale of labels for responsive editing.
    analysisLabels = new Int32Array(analysisW * analysisH);
    for (let y = 0; y < analysisH; y++) {
      const srcY = Math.min(height - 1, Math.floor(y / scale));
      for (let x = 0; x < analysisW; x++) {
        const srcX = Math.min(width - 1, Math.floor(x / scale));
        analysisLabels[y * analysisW + x] = labels[srcY * width + srcX];
      }
    }
    analysisImage = CORE.imageDataFromLabels(
      analysisLabels,
      analysisW,
      analysisH,
    );
  }

  return {
    imageData: analysisImage,
    labels: analysisLabels,
    components:
      analysisScale < 0.999
        ? CORE.buildComponentsFromLabels(
            analysisLabels,
            analysisW,
            analysisH,
            minSize,
          )
        : components,
    labelColors: paletteFromData(data, labelIds),
    labelsEdited: false,
    labelsCommitted: true,
    exportLabels: labels,
    exportImageData: null,
    width,
    height,
    analysisWidth: analysisW,
    analysisHeight: analysisH,
    analysisScale,
    pngBuffer: null,
    fullResReady: true,
    fromIdMask: true,
    meta: data.source || {},
    settings,
    restoredFromData: true,
  };
}

async function restoreIdMaskFromFolder() {
  const data = state.latestSplitData || state.folderData;
  const validation = DATA.validateSplitData(data);
  if (!validation.ok || !data.elements.length) return false;

  const bytes = await readFolderIdMaskBytes();
  if (!bytes) return false;

  const decoded = await decodePng(bytes, 0);
  const labels = CORE.decodeLabelsFromImageData(decoded.imageData);
  const docW =
    Number(data.document && data.document.width) || decoded.fullWidth;
  const docH =
    Number(data.document && data.document.height) || decoded.fullHeight;
  if (decoded.fullWidth !== docW || decoded.fullHeight !== docH) {
    // Mask dimensions must match the stored document size.
    return false;
  }

  state.sampledLabel = null;
  state.editTool = "sample";
  clearPreviewHover();
  state.scan = buildScanFromIdMaskLabels(
    labels,
    decoded.fullWidth,
    decoded.fullHeight,
    data,
  );
  state.scanMode = "restore";
  state.stage = "complete";
  state.statusKind = "ok";
  state.statusText = `Restored ${state.scan.components.length} element${state.scan.components.length === 1 ? "" : "s"} from ${DATA.ID_MASK_FILENAME}.`;
  return true;
}

async function writeIdMaskFile(labels, width, height, zipEntries) {
  const encoded = CORE.encodeLabelsToImageData(labels, width, height);
  const bytes = await imageDataToPngBytes(encoded);
  if (zipEntries) {
    zipEntries.push({ name: DATA.ID_MASK_FILENAME, data: bytes });
    return DATA.ID_MASK_FILENAME;
  }
  return writeFileToDirectory(DATA.ID_MASK_FILENAME, bytes);
}

function elementGroupName(data) {
  const prefix =
    (data && data.settings && data.settings.prefix) || state.prefix || "element";
  return `${prefix}s`;
}

function elementLayerName(filename) {
  return String(filename).replace(/\.png$/i, "");
}

async function placeNextImportLayer(requestId) {
  const job = state._importJob;
  if (!job || state.activeRequestId !== requestId) return;

  if (job.index >= job.layers.length) {
    completeImportJob();
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
    "import",
    IMPORT_STEP_TIMEOUT_MS,
  );
  render();

  try {
    postScript(makeImportOpenScript({ requestId, dataUrl: layer.dataUrl }));
  } catch (error) {
    job.awaitingOpenDone = false;
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function captureImportLayer(requestId) {
  const job = state._importJob;
  if (!job || state.activeRequestId !== requestId) return;
  if (job.index >= job.layers.length) return;

  const layer = job.layers[job.index];
  job.phase = "capturing";
  setWorking(
    "naming the layer",
    `Naming ${job.index + 1} / ${job.layers.length}: ${layer.name}`,
    requestId,
    "import",
    IMPORT_STEP_TIMEOUT_MS,
  );
  render();

  try {
    postScript(
      makeImportCaptureScript({
        requestId,
        index: job.index,
        total: job.layers.length,
        name: layer.name,
        knownLayerIds: job.knownLayerIds || [],
        groupId: job.groupId,
        groupName: job.groupName,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function completeImportJob() {
  const job = state._importJob;
  const groupName = (job && job.groupName) || "elements";
  const named = (job && job.named.length) || 0;
  const ungrouped = (job && job.ungrouped) || 0;
  clearActiveRequest();
  state.stage = "complete";
  state.statusKind = "ok";
  state.statusText = ungrouped
    ? `Imported ${named} Smart Object${named === 1 ? "" : "s"} (${ungrouped} outside “${groupName}”). Click Position Elements.`
    : `Imported ${named} Smart Object${named === 1 ? "" : "s"} into “${groupName}”. Click Position Elements.`;
  render();
}

async function readFolderElementsData(action) {
  if (state.destination !== "folder") {
    state.statusKind = "error";
    state.statusText =
      action === "import"
        ? "Switch destination to Folder to import exported PNGs."
        : "Switch destination to Folder to read stored element positions.";
    render();
    return null;
  }

  const ready = await ensureFolderPermission();
  if (!ready) {
    state.afterFolderChoice = action;
    return null;
  }

  let data = state.folderData;
  if (!data) data = await readFolderSplitData();
  const validation = DATA.validateSplitData(data);
  if (!validation.ok || !data.elements.length) {
    state.statusKind = "error";
    state.statusText = "Export to a folder first (writes alpha-split-data.json).";
    render();
    return null;
  }
  return data;
}

async function beginImportElements() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;

  const data = await readFolderElementsData("import");
  if (!data) return;

  const requestId = createRequestId();
  const timeoutMs = Math.min(
    1200000,
    Math.max(META.requestTimeoutMs || 180000, 60000 + data.elements.length * 8000),
  );
  setWorking(
    "preparing",
    "Reading exported PNGs to import…",
    requestId,
    "import",
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
        "import",
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
      layers.push({
        name: elementLayerName(element.filename),
        dataUrl: bytesToDataUrl(buffer, "image/png"),
      });
      await yieldToUi();
    }

    const groupName = elementGroupName(data);
    state._importJob = {
      layers,
      index: 0,
      groupName,
      groupId: null,
      phase: "ensure",
      captureRetries: 0,
      named: [],
      ungrouped: 0,
      knownLayerIds: [],
      awaitingOpenDone: false,
    };

    setWorking(
      "ensuring group",
      `Preparing group “${groupName}”…`,
      requestId,
      "import",
      IMPORT_STEP_TIMEOUT_MS,
    );
    render();
    postScript(makeImportEnsureGroupScript({ requestId, groupName }));
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function completePositionJob() {
  const job = state._positionJob;
  const groupName =
    (job && job.groupName) || state._positionGroupName || "elements";
  const positioned = job ? job.positioned : 0;
  const total = job ? job.placements.length : positioned;
  const missing = job && Array.isArray(job.missing) ? job.missing.slice() : [];
  state._positionJob = null;
  clearActiveRequest();
  state.stage = "complete";

  if (!missing.length) {
    state.statusKind = "ok";
    state.statusText = `Positioned ${positioned} element${positioned === 1 ? "" : "s"} from stored boxes.`;
    render();
    return;
  }

  const preview = missing.slice(0, 3).join(", ");
  const rest = missing.length > 3 ? ` +${missing.length - 3} more` : "";
  state.statusKind = "error";
  state.statusText = `Positioned ${positioned} of ${total}. Missing layers: ${preview}${rest}. Run Import Elements first.`;
  render();
}

function positionNextElement(requestId) {
  const job = state._positionJob;
  if (!job || state.activeRequestId !== requestId) return;

  if (job.index >= job.placements.length) {
    completePositionJob();
    return;
  }

  const item = job.placements[job.index];
  // Per-element timeout — a hung translate must not block for the full job budget.
  const timeoutMs = IMPORT_STEP_TIMEOUT_MS;
  setWorking(
    "positioning",
    `Positioning ${job.index + 1}/${job.placements.length}: ${item.name}…`,
    requestId,
    "position",
    timeoutMs,
  );
  render();


  try {
    postScript(
      makePositionMeasureScript({
        requestId,
        index: job.index,
        total: job.placements.length,
        name: item.name,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

function applyPositionElement(requestId, measurePayload) {
  const job = state._positionJob;
  if (!job || state.activeRequestId !== requestId) return;

  const item = job.placements[job.index];
  if (!item || item.name !== measurePayload.name) {
    failActiveRequest("Position lost track of the element list.");
    return;
  }

  const bounds = measurePayload.bounds;
  if (!bounds || bounds.length < 4) {
    failActiveRequest(
      `Could not read bounds for “${item.name}”. Try Import Elements again.`,
    );
    return;
  }

  const beforeL = unitValueToNumber(bounds[0]);
  const beforeT = unitValueToNumber(bounds[1]);
  const beforeR = unitValueToNumber(bounds[2]);
  const beforeB = unitValueToNumber(bounds[3]);
  const beforeW = beforeR - beforeL;
  const beforeH = beforeB - beforeT;
  const expectW = Number(item.width) || 0;
  const expectH = Number(item.height) || 0;
  const targetX = Number(item.x) || 0;
  const targetY = Number(item.y) || 0;


  if (!(beforeW > 0 && beforeH > 0) || !Number.isFinite(beforeL) || !Number.isFinite(beforeT)) {
    failActiveRequest(
      `Could not read bounds for “${item.name}” (got ${beforeW}×${beforeH} at ${beforeL},${beforeT}).`,
    );
    return;
  }

  let scaleX = 100;
  let scaleY = 100;
  let doResize = false;
  // Photopea Smart Object bounds often differ from the exported crop by 1–2px.
  // A 0.5% threshold skipped those; resize whenever any pixel side differs.
  if (expectW > 0 && expectH > 0 && beforeW > 0 && beforeH > 0) {
    scaleX = (expectW / beforeW) * 100;
    scaleY = (expectH / beforeH) * 100;
    if (
      Math.abs(expectW - beforeW) >= 1 ||
      Math.abs(expectH - beforeH) >= 1
    ) {
      doResize = true;
    }
  }

  // TOPLEFT resize keeps the measured top-left; translate from that origin.
  const dx = targetX - beforeL;
  const dy = targetY - beforeT;

  setWorking(
    "positioning",
    `Positioning ${job.index + 1}/${job.placements.length}: ${item.name}…`,
    requestId,
    "position",
    IMPORT_STEP_TIMEOUT_MS,
  );


  try {
    postScript(
      makePositionApplyScript({
        requestId,
        index: job.index,
        total: job.placements.length,
        name: item.name,
        scaleX,
        scaleY,
        doResize,
        dx,
        dy,
      }),
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function beginPositionElements() {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;

  const data = await readFolderElementsData("position");
  if (!data) return;

  const placements = data.elements.map((element) => ({
    name: elementLayerName(element.filename),
    x: Number(element.x) || 0,
    y: Number(element.y) || 0,
    width: Number(element.width) || 0,
    height: Number(element.height) || 0,
  }));
  if (!placements.length) {
    state.statusKind = "error";
    state.statusText = "No elements in the data file to position.";
    render();
    return;
  }
  const groupName = elementGroupName(data);
  const requestId = createRequestId();
  const timeoutMs = META.requestTimeoutMs || 180000;

  state._positionGroupName = groupName;
  state._positionJob = {
    placements,
    index: 0,
    positioned: 0,
    missing: [],
    groupName,
  };

  // Must arm activeRequestId before positionNextElement's guard, or the job
  // returns immediately and nothing happens (seen in debug logs).
  setWorking(
    "positioning",
    `Positioning 1/${placements.length}: ${placements[0].name}…`,
    requestId,
    "position",
    timeoutMs,
  );
  render();


  positionNextElement(requestId);
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
    const restoreMode = state.scanMode === "restore";

    // Generate starts from a fresh CCL. Restore remaps ids to stored elements.
    if (restoreMode) {
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
        ? " Edit used a downscaled pass; Export rebuilds at full resolution."
        : "";
    if (!components.length) {
      state.statusText =
        "No elements matched your thresholds. Lower alpha threshold or min pixels.";
    } else if (restored) {
      state.statusText = `Restored ${components.length} element${components.length === 1 ? "" : "s"} from Alpha Split data.${scaleNote}`;
    } else if (restoreMode) {
      state.statusText = `Could not match stored boxes — generated ${components.length} fresh element${components.length === 1 ? "" : "s"}.${scaleNote}`;
    } else {
      state.statusText = `ID Mask ready: ${components.length} separate element${components.length === 1 ? "" : "s"} detected.${scaleNote}`;
    }
    render();

    // Fresh Generate: persist JSON + ID mask immediately so Import/Position
    // can run without a separate Save click. Restore leaves existing files alone.
    if (!restoreMode && components.length) {
      await saveSplitDataAction();
    }
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function ensureFullResolutionScan(requestId, settings) {
  const scan = state.scan;
  if (!scan) throw new Error("ID Mask data is missing. Run Generate or Restore ID Mask again.");

  // Restored from alpha-split-id-mask.png: labels are already full-res.
  if (scan.fromIdMask) {
    let fullLabels = scan.exportLabels;
    if (scan.labelsEdited && scan.labelsCommitted) {
      const opaqueGuide = snapshotOpaqueFromLabels(
        scan.exportLabels,
        scan.width,
        scan.height,
      );
      compactScanLabelIds(scan, settings.minSize);
      fullLabels = resolveFullResLabelsForSave(scan, settings, opaqueGuide);
      syncPreviewFromFullLabels(scan, fullLabels, settings.minSize);
    }

    if (!fullLabels) {
      throw new Error("ID Mask data is missing. Run Generate or Restore ID Mask again.");
    }

    if (scan.exportImageData) {
      const components = CORE.buildComponentsFromLabels(
        fullLabels,
        scan.width,
        scan.height,
        settings.minSize,
      );
      scan.components = components;
      return {
        ...scan,
        imageData: scan.exportImageData,
        labels: fullLabels,
        components,
      };
    }
    // Artwork pixels are still needed for crops — caller captures them.
    return { needsArtwork: true, scan };
  }

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
      throw new Error("ID Mask data is missing. Run Generate or Restore ID Mask again.");
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
    throw new Error("ID Mask data is missing. Run Generate or Restore ID Mask again.");
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

function beginScan(mode = "generate") {
  if (!state.embedded) {
    state.statusKind = "idle";
    state.statusText = "Install the plugin to use it inside Photopea.";
    render();
    return;
  }
  if (state.statusKind === "working") return;

  if (mode === "restore") {
    const data = state.latestSplitData || state.folderData;
    const validation = DATA.validateSplitData(data);
    if (!validation.ok || !data.elements.length) {
      state.statusKind = "error";
      state.statusText =
        "Load Alpha Split data first (folder JSON), then Restore ID Mask.";
      render();
      return;
    }
  }

  readInputs();
  const validation = CORE.validateSettings(settingsFromState());
  if (!validation.ok) {
    state.stage = "error";
    state.statusKind = "error";
    state.statusText = validation.message;
    render();
    return;
  }

  if (mode === "restore") {
    // Prefer the exported ID mask file — no Photopea round trip.
    setWorking(
      "loading id mask",
      `Loading ${DATA.ID_MASK_FILENAME} from the export folder…`,
      createRequestId(),
      "scan",
    );
    render();
    restoreIdMaskFromFolder()
      .then((ok) => {
        if (ok) {
          clearActiveRequest();
          render();
          return;
        }
        beginScanCapture("restore");
      })
      .catch(() => {
        beginScanCapture("restore");
      });
    return;
  }

  beginScanCapture("generate");
}

function beginScanCapture(mode = "generate") {
  const requestId = createRequestId();
  const restoreMode = mode === "restore";
  state.scanMode = restoreMode ? "restore" : "generate";
  state.scan = null;
  state.pendingBinary = null;
  state.pendingDone = false;
  state._scanMeta = null;
  state.expectBinary = true;

  const docHint = state.latestSplitData?.document;
  const sizeHint =
    docHint && docHint.width && docHint.height
      ? ` ${docHint.width}×${docHint.height}`
      : "";
  // Generate uses the workfile-safe PSD snapshot path (pre-1.3.8 working behaviour).
  // Restore falls back to light PNG capture when no saved ID mask file is present.
  setWorking(
    restoreMode ? "exporting the layer" : "receiving snapshot",
    restoreMode
      ? `No saved ID mask found — exporting the active layer${sizeHint}…`
      : `Snapshotting the document${sizeHint} (large files take a while)…`,
    requestId,
    "scan",
  );
  render();


  try {
    postScript(
      restoreMode
        ? makeLightCaptureScript(requestId)
        : makeCaptureScript(requestId),
    );
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
  if (!state.scan || !state.scan.components.length || state.scan.schematic) {
    state.statusKind = "error";
    state.statusText =
      "Generate or Restore an ID Mask before exporting.";
    render();
    return;
  }
  if (state.scan.labelsEdited && !state.scan.labelsCommitted) {
    state.statusKind = "error";
    state.statusText =
      "Click Save data to apply preview edits before exporting.";
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
      "Detection settings changed. Run Generate or Restore ID Mask again before exporting.";
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
    const prepared = await ensureFullResolutionScan(requestId, settings);
    if (!prepared || state.activeRequestId !== requestId) return;

    if (prepared.needsArtwork) {
      // Mask was restored from file — grab artwork pixels with a light layer PNG.
      state._exportAfterArtwork = { requestId, settings, timeoutMs };
      state.pendingBinary = null;
      state.pendingDone = false;
      state.expectBinary = true;
      setWorking(
        "exporting the layer",
        "Capturing the active layer to crop exported PNGs…",
        requestId,
        "export",
        timeoutMs,
      );
      render();
      postScript(makeLightCaptureScript(requestId));
      return;
    }

    await writeExportOutputs(prepared, requestId, settings, timeoutMs);
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function continueExportWithArtwork(requestId, pngBuffer) {
  const pending = state._exportAfterArtwork;
  if (!pending || pending.requestId !== requestId) return;
  state._exportAfterArtwork = null;

  const settings = pending.settings;
  const timeoutMs = pending.timeoutMs;
  try {
    const decoded = await decodePng(pngBuffer, 0);
    if (state.activeRequestId !== requestId) return;
    const scan = state.scan;
    if (!scan || !scan.exportLabels) {
      failActiveRequest("ID Mask data is missing. Run Restore ID Mask again.");
      return;
    }
    if (
      decoded.fullWidth !== scan.width ||
      decoded.fullHeight !== scan.height
    ) {
      failActiveRequest(
        `Layer size ${decoded.fullWidth}×${decoded.fullHeight} does not match the ID mask ${scan.width}×${scan.height}.`,
      );
      return;
    }

    scan.exportImageData = decoded.imageData;
    scan.pngBuffer = pngBuffer;
    const components = CORE.buildComponentsFromLabels(
      scan.exportLabels,
      scan.width,
      scan.height,
      settings.minSize,
    );
    scan.components = components;
    await writeExportOutputs(
      {
        ...scan,
        imageData: decoded.imageData,
        labels: scan.exportLabels,
        components,
      },
      requestId,
      settings,
      timeoutMs,
    );
  } catch (error) {
    failActiveRequest(error && error.message ? error.message : String(error));
  }
}

async function writeExportOutputs(scan, requestId, settings, timeoutMs) {
  if (!scan.components.length) {
    failActiveRequest("No elements to export after Save data.");
    return;
  }

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
    written.push(await writeFileToDirectory(filename, bytes));
    await yieldToUi();
  }

  if (state.activeRequestId !== requestId) return;

  setWorking(
    "exporting",
    `Writing ${DATA.ID_MASK_FILENAME}…`,
    requestId,
    "export",
    timeoutMs,
  );
  render();

  await writeIdMaskFile(scan.labels, scan.width, scan.height, null);

  const splitData = DATA.buildSplitData({
    settings,
    components: scan.components,
    meta: scan.meta || {},
    width: scan.width,
    height: scan.height,
    pluginVersion: META.version,
    exported: true,
    labelColors: scan.labelColors || state.scan.labelColors,
  });
  state.latestSplitData = splitData;
  await writeFolderSplitData(splitData);

  clearActiveRequest();
  state.stage = "complete";
  state.statusKind = "ok";
  state.statusText = `Exported ${written.length} PNG${written.length === 1 ? "" : "s"}, ${DATA.ID_MASK_FILENAME}, and ${DATA.DATA_FILENAME} to “${state.folderName}”.`;
  render();
}

function handleBinary(buffer) {
  if (!state.activeRequestId) return;
  if (
    state.activeOperation === "export" &&
    state.stage === "exporting the layer"
  ) {
    state.pendingBinary = buffer;
    if (state.pendingDone) {
      state.pendingDone = false;
      handleDone();
    }
    return;
  }
  if (state.activeOperation !== "scan") return;
  if (
    state.stage === "receiving snapshot" ||
    state.stage === "exporting the layer" ||
    state.stage === "receiving file"
  ) {
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

  if (state.activeOperation === "import") {
    const job = state._importJob;
    if (!job) return;

    if (state.stage === "placing" && job.phase === "placing" && job.awaitingOpenDone) {
      // Open script finished; give Photopea a beat, then claim and name the new layer.
      job.awaitingOpenDone = false;
      const indexAtOpen = job.index;
      window.setTimeout(() => {
        if (
          state.activeRequestId &&
          state.activeOperation === "import" &&
          state._importJob &&
          state._importJob.index === indexAtOpen &&
          (state.stage === "placing" || state.stage === "naming the layer")
        ) {
          captureImportLayer(state.activeRequestId);
        }
      }, IMPORT_CAPTURE_DELAY_MS);
      return;
    }

    // If the naming script finished without an import-placed echo (or Free Transform
    // blocked the first attempt), retry instead of sitting on "Naming…" forever.
    if (
      (state.stage === "naming the layer" || job.phase === "capturing") &&
      job.index < job.layers.length
    ) {
      job.captureRetries = (job.captureRetries || 0) + 1;
      if (job.captureRetries > IMPORT_CAPTURE_RETRIES) {
        failActiveRequest(
          `Could not name “${job.layers[job.index].name}” after Free Transform. Press Enter in Photopea to confirm the place, then try Import again.`,
        );
        return;
      }
      const indexAtName = job.index;
      window.setTimeout(
        () => {
          if (
            state.activeRequestId &&
            state.activeOperation === "import" &&
            state._importJob &&
            state._importJob.index === indexAtName &&
            state.stage === "naming the layer"
          ) {
            captureImportLayer(state.activeRequestId);
          }
        },
        Math.min(1000, 250 + job.captureRetries * 100),
      );
    }
    return;
  }

  // Position runs as a single script and completes on its position-done echo.
  if (state.activeOperation === "position") return;

  if (
    state.activeOperation === "export" &&
    state.stage === "exporting the layer"
  ) {
    if (!state.pendingBinary) {
      state.pendingDone = true;
      return;
    }
    const layerPng = state.pendingBinary;
    state.pendingBinary = null;
    state.expectBinary = false;
    continueExportWithArtwork(state.activeRequestId, layerPng);
    return;
  }

  if (state.activeOperation !== "scan") return;

  if (state.stage === "receiving snapshot") {
    // Capture script sends: meta echo → PSD ArrayBuffer → "done" (order can vary slightly).
    // Do not fail-fast: Photopea can emit a stray "done" before echoes/binary.
    // Wait for meta+binary (or the request timeout).
    if (!state.pendingBinary || !state._scanMeta) {
      state.pendingDone = true;
      return;
    }
    openSnapshotCopy(state.activeRequestId, state.pendingBinary);
    return;
  }

  if (state.stage === "exporting the layer") {
    // Light capture: PNG from the workfile, then analyse.
    if (!state.pendingBinary || !state._scanMeta) {
      state.pendingDone = true;
      return;
    }
    const layerPng = state.pendingBinary;
    state.pendingBinary = null;
    state.expectBinary = false;
    finishScanAnalysis(state.activeRequestId, layerPng, state._scanMeta);
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

  if (payload.type === "probe") {
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
      (state.activeOperation === "scan" ||
        state.activeOperation === "export") &&
      (state.stage === "receiving snapshot" ||
        state.stage === "exporting the layer") &&
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

  if (payload.type === "import-group") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not create the elements group.");
      return;
    }
    if (!state._importJob) return;
    state._importJob.groupId = payload.groupId;
    state._importJob.knownLayerIds = Array.isArray(payload.knownLayerIds)
      ? payload.knownLayerIds.slice()
      : [];
    placeNextImportLayer(payload.requestId);
    return;
  }

  if (payload.type === "import-placed") {
    const job = state._importJob;
    if (!job) return;
    if (payload.notReady) {
      job.captureRetries = (job.captureRetries || 0) + 1;
      if (job.captureRetries > IMPORT_CAPTURE_RETRIES) {
        const seen = Array.isArray(payload.unknownNames)
          ? payload.unknownNames.filter(Boolean)
          : [];
        const hint = seen.length ? ` New layers seen: ${seen.join(", ")}.` : "";
        failActiveRequest(
          `${payload.message || "Smart Object did not finish loading in time."}${hint}`,
        );
        return;
      }
      window.setTimeout(
        () => {
          if (
            state.activeRequestId === payload.requestId &&
            state.activeOperation === "import"
          ) {
            captureImportLayer(payload.requestId);
          }
        },
        Math.min(1000, 200 + job.captureRetries * 100),
      );
      return;
    }
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not name an imported layer.");
      return;
    }
    const source = job.layers[payload.index];
    if (!source) {
      failActiveRequest("Import lost track of the element list.");
      return;
    }
    job.named.push(payload.name);
    if (!payload.grouped) job.ungrouped += 1;
    if (payload.layerId != null && payload.layerId >= 0) {
      job.knownLayerIds.push(payload.layerId);
    }
    // Drop the heavy dataUrl once placed so memory stays reasonable.
    source.dataUrl = null;
    job.index = payload.index + 1;
    placeNextImportLayer(payload.requestId);
    return;
  }

  if (payload.type === "position-measure") {
    const job = state._positionJob;
    if (!job || state.activeRequestId !== payload.requestId) return;
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not measure element bounds.");
      return;
    }
    if (!payload.found) {
      if (payload.name) job.missing.push(payload.name);
      job.index = Number(payload.index) + 1;
      positionNextElement(payload.requestId);
      return;
    }
    applyPositionElement(payload.requestId, payload);
    return;
  }

  if (payload.type === "position-apply" || payload.type === "position-one") {
    const job = state._positionJob;
    if (!job || state.activeRequestId !== payload.requestId) return;
    const item = job.placements[Number(payload.index)];
    const afterBounds = payload.afterBounds;
    const afterL = afterBounds ? unitValueToNumber(afterBounds[0]) : unitValueToNumber(payload.afterL);
    const afterT = afterBounds ? unitValueToNumber(afterBounds[1]) : unitValueToNumber(payload.afterT);
    const afterR = afterBounds ? unitValueToNumber(afterBounds[2]) : NaN;
    const afterB = afterBounds ? unitValueToNumber(afterBounds[3]) : NaN;
    const targetX = item ? Number(item.x) || 0 : Number(payload.targetX) || 0;
    const targetY = item ? Number(item.y) || 0 : Number(payload.targetY) || 0;
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not position the elements.");
      return;
    }
    if (payload.found) job.positioned += 1;
    else if (payload.name) job.missing.push(payload.name);
    job.index = Number(payload.index) + 1;
    positionNextElement(payload.requestId);
    return;
  }

  if (payload.type === "position-done") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not position the elements.");
      return;
    }
    // Legacy single-script reply — keep for older panel caches.
    if (state._positionJob) {
      state._positionJob.positioned = Number(payload.positioned) || 0;
      state._positionJob.missing = Array.isArray(payload.missing)
        ? payload.missing
        : [];
      state._positionJob.index = state._positionJob.placements.length;
    }
    completePositionJob();
    return;
  }

  if (payload.type === "import") {
    if (!payload.ok) {
      failActiveRequest(payload.message || "Could not import elements.");
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
      if (button.dataset.run === "scan" || button.dataset.run === "generate-mask") {
        beginScan("generate");
      }
      if (button.dataset.run === "export") beginExport();
      if (button.dataset.run === "import-elements") beginImportElements();
      if (button.dataset.run === "position-elements") beginPositionElements();
      if (button.dataset.run === "load-data-file") loadDataFileFromFolderOrPicker();
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
      if (action === "reassign") {
        reassignElementsAction();
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
      if (action === "save-data") {
        saveSplitDataAction();
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
        state.statusText = "Adjust thresholds if needed, then Generate ID Mask.";
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
    state.bootHint = `Checking “${state.folderName}” for ${DATA.DATA_FILENAME}…`;
    render();
    await readFolderSplitData();
    if (
      state.folderData &&
      (!state.latestSplitData || !state.latestSplitData.exported)
    ) {
      if (state.folderData.elements && state.folderData.elements.length) {
        await applyLoadedSplitData(state.folderData, "folder");
      } else {
        applyRestoredSettings(state.folderData, "folder");
        state.bootHint = `Found ${DATA.DATA_FILENAME} (settings only).`;
      }
    } else if (!state.folderData) {
      state.bootHint = `No ${DATA.DATA_FILENAME} in “${state.folderName}” yet.`;
    }
    render();

    if (state.exportAfterFolderChoice) {
      state.exportAfterFolderChoice = false;
      beginExport();
      return;
    }
    const resume = state.afterFolderChoice;
    state.afterFolderChoice = null;
    if (resume === "import") beginImportElements();
    if (resume === "position") beginPositionElements();
    if (resume === "save-data") saveSplitDataAction();
    return;
  }

  if (event.data.type === JSON_READY_MESSAGE) {
    const text = event.data.text;
    if (!text) {
      state.statusKind = "error";
      state.statusText = "No JSON file contents were returned.";
      render();
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (!(await applyLoadedSplitData(parsed, "file"))) {
        render();
        return;
      }
      if (event.data.name) state.dataFileName = String(event.data.name);
      render();
    } catch {
      state.statusKind = "error";
      state.statusText = "The selected file is not valid Alpha Split JSON.";
      render();
    }
    return;
  }

  if (event.data.type === CANCEL_MESSAGE) {
    state.exportAfterFolderChoice = false;
    state.afterFolderChoice = null;
    state.statusKind = "error";
    state.statusText =
      event.data.reason === "unsupported"
        ? "Folder access is unavailable in this browser."
        : event.data.reason === "json-cancelled"
          ? "No data file was selected."
          : "No export folder was selected.";
    render();
  }
}

function binaryFromMessage(data) {
  if (data instanceof ArrayBuffer) return data;
  // Some Photopea builds deliver export bytes as a TypedArray view.
  if (ArrayBuffer.isView(data) && data.buffer instanceof ArrayBuffer) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}

window.addEventListener("message", (event) => {
  if (
    event.data &&
    typeof event.data === "object" &&
    !(event.data instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(event.data) &&
    (event.data.type === READY_MESSAGE ||
      event.data.type === CANCEL_MESSAGE ||
      event.data.type === JSON_READY_MESSAGE)
  ) {
    handlePickerMessage(event);
    return;
  }

  if (!state.embedded || event.source !== window.parent) {
    return;
  }

  const binary = binaryFromMessage(event.data);
  if (binary) {
    handleBinary(binary);
    return;
  }

  if (event.data === "done") {
    handleDone();
    return;
  }

  if (typeof event.data !== "string") {
    return;
  }

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
  // Folder JSON is the only auto-restore source (no data layer).
  if (state.folderData) {
    if (state.folderData.elements && state.folderData.elements.length) {
      await applyLoadedSplitData(state.folderData, "folder");
    } else {
      applyRestoredSettings(state.folderData, "folder");
      state.bootHint = `Found ${DATA.DATA_FILENAME} (settings only).`;
    }
    render();
    return true;
  }
  return false;
}

async function bootstrapPanel() {
  // Paint first so the panel is usable even if storage or Photopea is slow.
  state.bootHint = "Looking for a remembered export folder…";
  render();
  try {
    await loadStoredDirectoryHandle();
    if (state.folderPermission === "granted") {
      state.bootHint = `Reading ${DATA.DATA_FILENAME} from “${state.folderName}”…`;
      render();
      await readFolderSplitData();
      if (!state.folderData) {
        state.bootHint = `No ${DATA.DATA_FILENAME} in “${state.folderName}” yet.`;
      }
    } else {
      state.bootHint = "Choose an export folder to load saved data automatically.";
    }
  } catch {
    state.bootHint = "Folder memory unavailable in this browser.";
  }
  render();

  // Auto-load folder data (+ ID mask) once folder JSON is available.
  await restoreSavedSettings();
}

bootstrapPanel();
