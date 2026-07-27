"use strict";

const DB_NAME = "photopea-alpha-split";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "export-directory";
const READY_MESSAGE = "ALPHA_SPLIT_DIRECTORY_READY";
const CANCEL_MESSAGE = "ALPHA_SPLIT_DIRECTORY_CANCELLED";

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

async function initializePicker() {
  const mode = new URLSearchParams(window.location.search).get("mode");
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
  ?.addEventListener("click", chooseFolder);

initializePicker();
