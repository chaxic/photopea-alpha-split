"use strict";

const DB_NAME = "photopea-alpha-split";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "export-directory";
const READY_MESSAGE = "ALPHA_SPLIT_DIRECTORY_READY";
const CANCEL_MESSAGE = "ALPHA_SPLIT_DIRECTORY_CANCELLED";
const JSON_READY_MESSAGE = "ALPHA_SPLIT_JSON_READY";

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

async function loadDirectoryHandle() {
  const database = await openDatabase();
  const handle = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(DIRECTORY_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}

function notifyOpener(type, detail = {}) {
  if (!window.opener) return;
  window.opener.postMessage({ type, ...detail }, window.location.origin);
}

function setStatus(message, kind = "") {
  const status = document.querySelector("#picker-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

function setPickerCopy(title, copy, buttonLabel) {
  const heading = document.querySelector("#picker-title");
  const description = document.querySelector("#picker-copy");
  const button = document.querySelector("#choose-folder");
  if (heading) heading.textContent = title;
  if (description) description.textContent = copy;
  if (button) button.textContent = buttonLabel;
}

let rememberedHandle = null;
let pickerMode = "folder";

async function finishWithHandle(handle) {
  await storeDirectoryHandle(handle);
  setStatus(`Using “${handle.name}”. Returning to Photopea…`, "ok");
  notifyOpener(READY_MESSAGE, { name: handle.name, handle });
  setTimeout(() => window.close(), 650);
}

async function chooseFolder() {
  if (!("showDirectoryPicker" in window)) {
    setStatus(
      "This browser does not support direct folder access. Use ZIP download in the plugin.",
      "error",
    );
    notifyOpener(CANCEL_MESSAGE, { reason: "unsupported" });
    return;
  }

  const button = document.querySelector("#choose-folder");
  button.disabled = true;
  setStatus("Waiting for a folder…");

  try {
    if (rememberedHandle) {
      let permission = await rememberedHandle.queryPermission({
        mode: "readwrite",
      });
      if (permission !== "granted") {
        permission = await rememberedHandle.requestPermission({
          mode: "readwrite",
        });
      }

      if (permission === "granted") {
        await finishWithHandle(rememberedHandle);
        return;
      }

      rememberedHandle = null;
      setPickerCopy(
        "Choose an export folder",
        "Access was not granted. Choose the folder again, or close this window and use ZIP download.",
        "Choose folder",
      );
      setStatus("Click Choose folder to select a destination.", "error");
      button.disabled = false;
      return;
    }

    const handle = await window.showDirectoryPicker({
      id: "photopea-alpha-split",
      mode: "readwrite",
      startIn: "pictures",
    });

    await finishWithHandle(handle);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("No folder was selected.", "error");
      notifyOpener(CANCEL_MESSAGE, { reason: "cancelled" });
    } else {
      setStatus(
        (error && error.message) || "The folder could not be opened.",
        "error",
      );
      notifyOpener(CANCEL_MESSAGE, { reason: "error" });
    }
    button.disabled = false;
  }
}

async function chooseJsonFile() {
  const button = document.querySelector("#choose-folder");
  button.disabled = true;
  setStatus("Waiting for a JSON file…");

  try {
    if (!("showOpenFilePicker" in window)) {
      setStatus(
        "This browser does not support the file picker. Grant folder access in the plugin and try Load data file again.",
        "error",
      );
      notifyOpener(CANCEL_MESSAGE, { reason: "unsupported" });
      button.disabled = false;
      return;
    }

    const [handle] = await window.showOpenFilePicker({
      id: "photopea-alpha-split-json",
      multiple: false,
      types: [
        {
          description: "Alpha Split data",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    const file = await handle.getFile();
    const text = await file.text();
    setStatus(`Loaded “${file.name}”. Returning to Photopea…`, "ok");
    notifyOpener(JSON_READY_MESSAGE, {
      name: file.name,
      text,
    });
    setTimeout(() => window.close(), 650);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("No file was selected.", "error");
      notifyOpener(CANCEL_MESSAGE, { reason: "json-cancelled" });
    } else {
      setStatus(
        (error && error.message) || "The JSON file could not be opened.",
        "error",
      );
      notifyOpener(CANCEL_MESSAGE, { reason: "error" });
    }
    button.disabled = false;
  }
}

async function initializePicker() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  pickerMode = mode === "json" ? "json" : "folder";

  if (pickerMode === "json") {
    setPickerCopy(
      "Load Alpha Split data",
      "Choose an alpha-split-data.json file (or any valid Alpha Split export JSON). Element boxes and settings will load into the panel.",
      "Choose JSON file",
    );
    setStatus("Your file stays on this device.");
    document.title = "Load Alpha Split data";
    return;
  }

  if (mode === "choose" || mode === "change") return;

  try {
    rememberedHandle = await loadDirectoryHandle();
  } catch {
    rememberedHandle = null;
  }

  if (!rememberedHandle) return;

  setPickerCopy(
    `Restore access to “${rememberedHandle.name}”`,
    "Browsers pause folder access after a session ends. Restore access here, then the export will continue automatically.",
    "Restore access",
  );
  setStatus("Your remembered folder is ready to reconnect.");
}

document
  .querySelector("#choose-folder")
  ?.addEventListener("click", () => {
    if (pickerMode === "json") chooseJsonFile();
    else chooseFolder();
  });

initializePicker();
