/**
 * Hackathon UI: link project PDFs to a parameter value.
 * Connection lives in src/streambim.js. Link logic lives in src/pdf-links.js.
 */

import { objects } from "./mock-data.js";
import {
  createLinkBackend,
  describeInfoShape,
  filenameHasValue,
  formatBytes,
  isLinkableValue,
  MAX_PDF_BYTES,
  messageOf,
  naturalCompare,
  parametersFromInfo,
  saveLink,
  scanDocuments,
  scanNeedsConfirmation,
  sortHits,
} from "./pdf-links.js";
import { connectWidget } from "./streambim.js";
import "./style.css";

const teamName = import.meta.env.VITE_TEAM_NAME || document.querySelector("h1").textContent;
document.title = teamName;
document.querySelector("h1").textContent = teamName;

const $ = (selector) => document.querySelector(selector);

const statusEl = $("#status");
const emptyEl = $("#empty");
const factsEl = $("#facts");
const nameEl = $("#name");
const typeEl = $("#type");
const floorEl = $("#floor");
const simulatorEl = $("#simulator");
const chipsEl = $("#object-chips");
const objectLinksEl = $("#object-links");
const parameterHintEl = $("#parameter-hint");
const parameterListEl = $("#parameter-list");
const valuesSummaryEl = $("#values-summary");
const pdfStepEl = $("#pdf-step");
const scopeOneEl = $("#scope-one");
const scopeOneLabelEl = $("#scope-one-label");
const scopeKindEl = $("#scope-kind");
const kindEl = $("#kind");
const scopeAllEl = $("#scope-all");
const scopeAllLabelEl = $("#scope-all-label");
const valueChoiceEl = $("#value-choice");
const valueSummaryEl = $("#value-summary");
const valueListEl = $("#value-list");
const folderEl = $("#folder");
const pdfSummaryEl = $("#pdf-summary");
const scanEl = $("#scan");
const cancelEl = $("#cancel");
const scanConfirmEl = $("#scan-confirm");
const scanConfirmTextEl = $("#scan-confirm-text");
const scanConfirmYesEl = $("#scan-confirm-yes");
const progressEl = $("#progress");
const progressTextEl = $("#progress-text");
const reviewStepEl = $("#review-step");
const reviewSummaryEl = $("#review-summary");
const reviewListEl = $("#review-list");
const reviewNotesEl = $("#review-notes");
const saveEl = $("#save");
const saveSummaryEl = $("#save-summary");

const modeLabel = {
  mock: "Lokalt",
  live: "Live",
  error: "Ingen kontakt",
};

const state = {
  backend: null,
  parameter: null,
  values: {},
  pdfs: [],
  pickedParameters: [],
  pickedDiagnostic: "",
  pickedKind: null,
  kinds: {},
  choiceValues: {},
  selectedValues: new Set(),
  choiceToken: 0,
  pickToken: 0,
  scanning: false,
  cancelRequested: false,
  saving: false,
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function dash(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "–";
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function fromInfo(info) {
  const props = info && info.properties && typeof info.properties === "object" ? info.properties : {};
  const storey = props["@Building Storey"];
  const storeyName = storey && typeof storey === "object" ? storey.Name : storey;
  const floors = Array.isArray(info && info.floors) ? info.floors : [];
  const listed = floors
    .map((floor) => (floor && (floor.name || floor.Name)) || (typeof floor === "string" ? floor : ""))
    .find(Boolean);
  return {
    name: info && (info.name || props.Name || props["Long Name"]),
    type: info && (info.type || props["@kind"]),
    floor: info && (info.floor || storeyName || listed),
  };
}

function mark(api, guid, shiftKey) {
  if (!shiftKey) {
    try {
      api.deHighlightAllObjects();
    } catch {
      /* The clear never answers. Fire it and move on. */
    }
  }
  setTimeout(() => {
    api.highlightObject(guid).catch(() => {});
  }, 40);
}

async function showPick(api, guid, shiftKey) {
  const token = ++state.pickToken;
  emptyEl.hidden = true;
  factsEl.hidden = false;
  nameEl.textContent = "…";
  typeEl.textContent = "…";
  floorEl.textContent = "…";
  mark(api, guid, shiftKey);
  try {
    const info = await api.getObjectInfo(guid);
    if (token !== state.pickToken) return;
    const row = fromInfo(info);
    nameEl.textContent = dash(row.name);
    typeEl.textContent = dash(row.type);
    floorEl.textContent = dash(row.floor);
    state.pickedParameters = parametersFromInfo(info);
    state.pickedKind = row.type || null;
    state.pickedDiagnostic = "";
    if (!state.pickedParameters.length && state.backend) {
      try {
        const record = await state.backend.objectRecord(guid);
        if (token !== state.pickToken) return;
        state.pickedParameters = parametersFromInfo(record);
        if (!state.pickedParameters.length) {
          state.pickedDiagnostic = `viewer: ${describeInfoShape(info)} rest: ${describeInfoShape(record)}`;
        }
      } catch (error) {
        if (token !== state.pickToken) return;
        console.error("objectRecord", error);
        state.pickedDiagnostic = `viewer: ${describeInfoShape(info)} rest-fel: ${messageOf(error)}`;
      }
    }
  } catch (error) {
    if (token !== state.pickToken) return;
    console.error("getObjectInfo", error);
    nameEl.textContent = dash(guid);
    typeEl.textContent = "–";
    floorEl.textContent = "–";
    state.pickedParameters = [];
  }
  renderParameters();
  if (state.parameter) renderScope();
  await renderObjectLinks();
}

/* ---------- 1. Parameter ---------- */

function renderParameters() {
  parameterListEl.replaceChildren();
  if (!state.pickedParameters.length) {
    parameterHintEl.hidden = false;
    parameterHintEl.textContent = "Objektet har inga parametrar att välja. Klicka på ett annat objekt.";
    if (state.pickedDiagnostic) {
      parameterListEl.append(el("code", { className: "diagnostic", textContent: state.pickedDiagnostic }));
    }
    return;
  }
  parameterHintEl.hidden = true;
  for (const parameter of state.pickedParameters) {
    // Virtual ids are only documented for text values, so other types can't be chosen yet.
    const isText = parameter.valueType === "str";
    const input = el("input", {
      type: "radio",
      name: "parameter",
      disabled: !isText || state.scanning,
      checked: state.parameter?.key === parameter.key,
    });
    input.dataset.selectable = String(isText);
    input.addEventListener("change", () => chooseParameter(parameter));
    parameterListEl.append(
      el(
        "label",
        { className: `option${isText ? "" : " muted"}` },
        input,
        el(
          "span",
          { className: "option-text" },
          el("b", { textContent: `${parameter.pset} › ${parameter.property}` }),
          el("small", { textContent: isText ? parameter.value : `${parameter.value} (bara textvärden går att länka)` }),
        ),
      ),
    );
  }
}

async function chooseParameter(parameter) {
  state.parameter = parameter;
  state.values = {};
  reviewStepEl.hidden = true;
  valuesSummaryEl.hidden = false;
  valuesSummaryEl.textContent = "Hämtar värden…";
  pdfStepEl.hidden = true;
  try {
    state.values = await state.backend.valuesFor(parameter);
    const count = Object.keys(state.values).length;
    valuesSummaryEl.textContent = `${plural(count, "värde", "värden")} i modellen för ${parameter.pset} › ${parameter.property}.`;
    pdfStepEl.hidden = count === 0;
    await loadKinds();
    renderScope();
    refreshValueChoice();
    if (count > 0) await loadFolders();
  } catch (error) {
    console.error("valuesFor", error);
    valuesSummaryEl.textContent = `Kunde inte hämta värden: ${messageOf(error)}`;
  }
  await renderObjectLinks();
}

/* ---------- 2. PDFs and scan ---------- */

function pickedValue() {
  return state.pickedParameters.find((item) => item.key === state.parameter?.key)?.value;
}

async function loadKinds() {
  try {
    state.kinds = await state.backend.listKinds();
  } catch (error) {
    console.error("listKinds", error);
    state.kinds = {};
  }
  const names = Object.keys(state.kinds).sort(naturalCompare);
  kindEl.replaceChildren(
    ...names.map((name) => el("option", { value: name, textContent: `${name} (${state.kinds[name]})` })),
  );
  scopeKindEl.disabled = names.length === 0;
  followPickedKind();
}

function followPickedKind() {
  if (!scopeKindEl.checked && state.pickedKind && state.kinds[state.pickedKind] != null) {
    kindEl.value = state.pickedKind;
  }
}

/** Follows the clicked object. An object without the parameter can't search its own value. */
function renderScope() {
  const value = pickedValue();
  scopeOneEl.disabled = value == null;
  scopeOneLabelEl.textContent = value == null ? "Objektet saknar parametern" : `Bara ${value}`;
  scopeAllLabelEl.textContent = `Alla ${plural(Object.keys(state.values).length, "värde", "värden")} i modellen`;
  followPickedKind();
  if (value == null && scopeOneEl.checked) {
    scopeAllEl.checked = true;
    refreshValueChoice();
  }
}

async function refreshValueChoice() {
  const token = ++state.choiceToken;
  state.selectedValues = new Set();
  valueListEl.replaceChildren();
  updateScanButton();
  if (scopeOneEl.checked) {
    valueChoiceEl.hidden = true;
    return;
  }
  valueChoiceEl.hidden = false;
  valueSummaryEl.textContent = "Hämtar värden…";
  let values = state.values;
  if (scopeKindEl.checked) {
    try {
      values = await state.backend.valuesForKind(state.parameter, kindEl.value, state.kinds[kindEl.value]);
    } catch (error) {
      if (token !== state.choiceToken) return;
      console.error("valuesForKind", error);
      valueSummaryEl.textContent = `Kunde inte hämta värden: ${messageOf(error)}`;
      return;
    }
    if (token !== state.choiceToken) return;
  }
  state.choiceValues = values;
  state.selectedValues = new Set(Object.keys(values));
  renderValueList();
}

function renderValueList() {
  const names = Object.keys(state.choiceValues).sort(naturalCompare);
  valueListEl.replaceChildren(
    ...names.map((name) => {
      const input = el("input", { type: "checkbox", checked: state.selectedValues.has(name) });
      input.addEventListener("change", () => {
        if (input.checked) state.selectedValues.add(name);
        else state.selectedValues.delete(name);
        updateValueSummary();
      });
      return el(
        "label",
        { className: "option compact" },
        input,
        el(
          "span",
          { className: "option-text" },
          el("b", { textContent: name }),
          el("small", { textContent: plural(state.choiceValues[name], "objekt", "objekt") }),
        ),
      );
    }),
  );
  updateValueSummary();
}

function updateValueSummary() {
  const total = Object.keys(state.choiceValues).length;
  valueSummaryEl.textContent = total
    ? `${state.selectedValues.size} av ${plural(total, "värde", "värden")} valda`
    : "Inga objekt av typen har parametern.";
  updateScanButton();
}

function setAllValues(selected) {
  state.selectedValues = new Set(selected ? Object.keys(state.choiceValues) : []);
  renderValueList();
}

function valuesToSearch() {
  return scopeOneEl.checked ? [pickedValue()] : [...state.selectedValues];
}

function updateScanButton() {
  const hasValues = scopeOneEl.checked ? pickedValue() != null : state.selectedValues.size > 0;
  scanEl.disabled = state.scanning || state.pdfs.length === 0 || !hasValues;
}

async function loadFolders() {
  if (folderEl.options.length) return loadPdfs();
  folderEl.replaceChildren(el("option", { value: "", textContent: "Alla mappar" }));
  try {
    const folders = await state.backend.listFolders();
    for (const folder of folders) folderEl.append(el("option", { value: folder.id, textContent: folder.name }));
  } catch (error) {
    console.error("listFolders", error);
  }
  return loadPdfs();
}

async function loadPdfs() {
  scanConfirmEl.hidden = true;
  scanEl.disabled = true;
  pdfSummaryEl.textContent = "Hämtar PDF-lista…";
  try {
    state.pdfs = await state.backend.listPdfs(folderEl.value);
    const bytes = state.pdfs.reduce((sum, doc) => sum + (doc.filesize || 0), 0);
    pdfSummaryEl.textContent = `${plural(state.pdfs.length, "PDF", "PDF:er")}, ${formatBytes(bytes)} totalt.`;
    updateScanButton();
  } catch (error) {
    console.error("listPdfs", error);
    state.pdfs = [];
    pdfSummaryEl.textContent = `Kunde inte hämta PDF:er: ${messageOf(error)}`;
  }
}

function requestScan() {
  if (scanNeedsConfirmation(state.pdfs)) {
    const bytes = state.pdfs.reduce((sum, doc) => sum + (doc.filesize || 0), 0);
    scanConfirmTextEl.textContent = `Det här laddar ner ${plural(state.pdfs.length, "PDF", "PDF:er")} (${formatBytes(bytes)}), en i taget. Välj gärna en mapp för att söka i färre.`;
    scanConfirmEl.hidden = false;
    return;
  }
  runScan();
}

async function runScan() {
  scanConfirmEl.hidden = true;
  state.scanning = true;
  state.cancelRequested = false;
  scanEl.disabled = true;
  folderEl.disabled = true;
  cancelEl.hidden = false;
  cancelEl.disabled = false;
  progressEl.hidden = false;
  progressTextEl.hidden = false;
  reviewStepEl.hidden = true;
  setParameterLocked(true);

  const docs = [...state.pdfs];
  const values = valuesToSearch();
  const result = await scanDocuments(state.backend, docs, values, {
    isCancelled: () => state.cancelRequested,
    onProgress(done, total, doc) {
      progressEl.max = total;
      progressEl.value = done;
      progressTextEl.textContent = doc ? `${done + 1} av ${total}: ${doc.filename}` : "";
    },
  });

  state.scanning = false;
  updateScanButton();
  folderEl.disabled = false;
  cancelEl.hidden = true;
  progressEl.hidden = true;
  progressTextEl.hidden = true;
  setParameterLocked(false);
  renderReview(result, docs.length, values);
}

function setParameterLocked(locked) {
  for (const input of parameterListEl.querySelectorAll("input")) {
    input.disabled = locked || input.dataset.selectable !== "true";
  }
  scopeKindEl.disabled = locked || Object.keys(state.kinds).length === 0;
  scopeAllEl.disabled = locked;
  kindEl.disabled = locked;
  scopeOneEl.disabled = locked || pickedValue() == null;
}

/* ---------- 3. Review and save ---------- */

function noteList(title, items) {
  return el(
    "div",
    { className: "review-note" },
    el("b", { textContent: title }),
    el("ul", {}, ...items.map((text) => el("li", { textContent: text }))),
  );
}

function renderReview(result, total, values) {
  reviewStepEl.hidden = false;
  saveSummaryEl.hidden = true;
  reviewListEl.replaceChildren();
  reviewNotesEl.replaceChildren();

  const hits = sortHits(result.hits);
  const scanned = total - result.failed.length - result.skipped.length;
  // A cancelled search, or one that read no PDF, can't say that a value has no PDF.
  const conclusive = !result.cancelled && scanned > 0;
  const found = new Set(hits.map((hit) => hit.value));
  const missing = conclusive ? values.filter((value) => !found.has(value)).sort(naturalCompare) : [];
  let nextMissing = 0;
  const appendMissingBefore = (value) => {
    while (nextMissing < missing.length && (value == null || naturalCompare(missing[nextMissing], value) < 0)) {
      reviewListEl.append(missingRow(missing[nextMissing]));
      nextMissing += 1;
    }
  };

  let groupInputs = null;
  let currentValue = null;
  for (const hit of hits) {
    if (hit.value !== currentValue) {
      appendMissingBefore(hit.value);
      currentValue = hit.value;
      groupInputs = [];
      reviewListEl.append(groupHead(hit.value, hits.filter((item) => item.value === hit.value).length, groupInputs));
    }
    const linkable = isLinkableValue(hit.value);
    const input = el("input", { type: "checkbox", checked: linkable });
    const status = el("small", { className: "row-status" });
    const row = el(
      "label",
      { className: "option" },
      input,
      el(
        "span",
        { className: "option-text" },
        el("b", { textContent: hit.doc.filename }),
        el("small", { textContent: `Sida ${hit.page}: ${hit.snippet}` }),
        filenameHasValue(hit) ? el("small", { className: "tag", textContent: "Värdet finns i filnamnet" }) : "",
        linkable ? "" : el("small", { className: "warn", textContent: "Kort värde, kontrollera innan du sparar." }),
        status,
      ),
    );
    row.hit = hit;
    row.input = input;
    row.status = status;
    input.addEventListener("change", updateSaveButton);
    groupInputs.push(input);
    reviewListEl.append(row);
  }
  appendMissingBefore(null);
  for (const toggle of reviewListEl.querySelectorAll(".group-head input")) toggle.sync();

  const prefix = result.cancelled ? "Sökningen avbröts. " : "";
  const hitText = hits.length
    ? `${plural(hits.length, "träff", "träffar")}. Bocka av de som inte stämmer.`
    : "Inga träffar.";
  const missingText = missing.length ? ` ${plural(missing.length, "värde", "värden")} utan PDF.` : "";
  reviewSummaryEl.textContent = `${prefix}${hitText}${missingText}`;

  if (!result.cancelled && total > 0 && scanned === 0 && result.failed.length) {
    reviewNotesEl.append(
      el("p", { className: "warn", textContent: "Ingen PDF gick att läsa, så texten kunde inte sökas." }),
    );
  }
  if (result.noText.length) {
    reviewNotesEl.append(noteList("Utan text, kan inte sökas (kanske inskannade):", result.noText.map((doc) => doc.filename)));
  }
  if (result.skipped.length) {
    reviewNotesEl.append(
      noteList(`Hoppades över, större än ${formatBytes(MAX_PDF_BYTES)}:`, result.skipped.map((doc) => doc.filename)),
    );
  }
  if (result.failed.length) {
    reviewNotesEl.append(
      noteList("Gick inte att läsa:", result.failed.map(({ doc, reason }) => `${doc.filename}: ${reason}`)),
    );
  }
  updateSaveButton();
}

/** Same row as a value heading, with a red cross instead of a checkbox. */
function missingRow(value) {
  const count = state.choiceValues[value];
  return el(
    "div",
    { className: "group-head missing" },
    el("span", { className: "cross", textContent: "✕", ariaHidden: "true" }),
    el("b", { textContent: value }),
    el("small", { textContent: count ? `Ingen PDF hittades · ${plural(count, "objekt", "objekt")}` : "Ingen PDF hittades" }),
  );
}

/** One heading per value, with a checkbox that ticks that value's PDFs together. */
function groupHead(value, count, inputs) {
  const toggle = el("input", { type: "checkbox" });
  toggle.sync = () => {
    const ticked = inputs.filter((input) => input.checked).length;
    toggle.checked = ticked === inputs.length;
    toggle.indeterminate = ticked > 0 && ticked < inputs.length;
  };
  toggle.addEventListener("change", () => {
    for (const input of inputs) input.checked = toggle.checked;
    updateSaveButton();
  });
  return el(
    "label",
    { className: "group-head" },
    toggle,
    el("b", { textContent: value }),
    el("small", { textContent: plural(count, "PDF", "PDF:er") }),
  );
}

function reviewRows() {
  return [...reviewListEl.querySelectorAll(".option")];
}

function updateSaveButton() {
  for (const toggle of reviewListEl.querySelectorAll(".group-head input")) toggle.sync();
  const count = reviewRows().filter((row) => row.input.checked).length;
  saveEl.disabled = count === 0 || state.saving;
  saveEl.textContent = count === 1 ? "Spara 1 länk" : `Spara ${count} länkar`;
}

async function saveSelected() {
  const rows = reviewRows().filter((row) => row.input.checked);
  const parameter = state.parameter;
  const counts = { linked: 0, exists: 0, failed: 0 };
  state.saving = true;
  saveEl.disabled = true;
  for (const row of reviewRows()) row.input.disabled = true;

  // One at a time on purpose: this writes to the project.
  for (const row of rows) {
    row.status.textContent = "Sparar…";
    row.status.className = "row-status";
    let outcome = "failed";
    try {
      outcome = await saveLink(state.backend, parameter, row.hit.value, row.hit.doc);
    } catch (error) {
      console.error("saveLink", error);
    }
    counts[outcome] += 1;
    row.status.textContent = { linked: "Länkad", exists: "Fanns redan", failed: "Kunde inte sparas" }[outcome];
    row.status.className = `row-status ${outcome}`;
    if (outcome !== "failed") row.input.checked = false;
  }

  state.saving = false;
  for (const row of reviewRows()) row.input.disabled = false;
  saveSummaryEl.hidden = false;
  saveSummaryEl.textContent = `${counts.linked} sparade, ${counts.exists} fanns redan, ${counts.failed} misslyckades.`;
  updateSaveButton();
  await renderObjectLinks();
}

/* ---------- Links on the picked object ---------- */

async function renderObjectLinks() {
  const token = state.pickToken;
  const parameter = state.parameter;
  const onObject = parameter && state.pickedParameters.find((item) => item.key === parameter.key);
  if (!onObject) {
    objectLinksEl.hidden = true;
    objectLinksEl.replaceChildren();
    return;
  }
  let links;
  try {
    links = await state.backend.listLinks(parameter, onObject.value);
  } catch (error) {
    if (token !== state.pickToken) return;
    console.error("listLinks", error);
    objectLinksEl.hidden = false;
    objectLinksEl.replaceChildren(el("p", { className: "note", textContent: `Kunde inte hämta länkar: ${messageOf(error)}` }));
    return;
  }
  if (token !== state.pickToken) return;

  objectLinksEl.hidden = false;
  objectLinksEl.replaceChildren(
    el("p", { className: "links-title", textContent: `PDF:er för ${parameter.property} = ${onObject.value}` }),
  );
  if (!links.length) {
    objectLinksEl.append(el("p", { className: "note", textContent: "Inga länkade PDF:er." }));
    return;
  }
  for (const link of links) {
    objectLinksEl.append(linkRow(link, parameter, onObject.value));
  }
}

function linkRow(link, parameter, value) {
  const open = el("button", { type: "button", className: "link-name", textContent: dash(link.filename) });
  open.addEventListener("click", async () => {
    // Open first: a window opened after an await is stopped by popup blockers.
    const opened = window.open("about:blank", "_blank");
    try {
      const url = await state.backend.documentUrl(link);
      if (opened) opened.location.href = url;
    } catch (error) {
      if (opened) opened.close();
      console.error("documentUrl", error);
    }
  });

  const remove = el("button", { type: "button", className: "small", textContent: "Ta bort" });
  remove.addEventListener("click", async () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "true";
      remove.textContent = "Bekräfta";
      return;
    }
    remove.disabled = true;
    try {
      await state.backend.removeLink(link);
    } catch (error) {
      // A 204 reaches a widget as an error even when it worked. The list below is the truth.
      console.error("removeLink", error);
    }
    await renderObjectLinks();
  });

  return el("div", { className: "link-row" }, open, remove);
}

/* ---------- Mock simulator and startup ---------- */

function renderChips(api) {
  chipsEl.replaceChildren();
  for (const object of objects) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = object.name;
    button.addEventListener("click", () => {
      for (const chip of chipsEl.querySelectorAll("button")) chip.classList.remove("on");
      button.classList.add("on");
      api.simulate?.pick(object.guid);
    });
    chipsEl.append(button);
  }
}

function loadWidgetApi() {
  if (window.StreamBIM?.connectToParent) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `${import.meta.env.BASE_URL}streambim-widget-api.min.js`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.append(script);
  });
}

folderEl.addEventListener("change", loadPdfs);
scopeOneEl.addEventListener("change", refreshValueChoice);
scopeKindEl.addEventListener("change", refreshValueChoice);
scopeAllEl.addEventListener("change", refreshValueChoice);
kindEl.addEventListener("change", () => {
  scopeKindEl.checked = true;
  refreshValueChoice();
});
$("#values-all").addEventListener("click", () => setAllValues(true));
$("#values-none").addEventListener("click", () => setAllValues(false));
scanEl.addEventListener("click", requestScan);
scanConfirmYesEl.addEventListener("click", runScan);
saveEl.addEventListener("click", saveSelected);
cancelEl.addEventListener("click", () => {
  state.cancelRequested = true;
  cancelEl.disabled = true;
});

const ready = loadWidgetApi().then(() =>
  connectWidget({
    onPickedObject(result) {
      const guid = result && result.guid;
      if (!guid) return;
      ready.then((api) => showPick(api, guid, Boolean(result.shiftKey)));
    },
  }),
);

ready
  .then((api) => {
    statusEl.dataset.mode = api.mode;
    statusEl.textContent = modeLabel[api.mode] || api.mode;
    simulatorEl.hidden = api.mode !== "mock";
    if (api.mode === "mock") renderChips(api);
    if (api.mode !== "error") state.backend = createLinkBackend(api);
  })
  .catch(() => {
    statusEl.dataset.mode = "error";
    statusEl.textContent = modeLabel.error;
    simulatorEl.hidden = true;
  });
