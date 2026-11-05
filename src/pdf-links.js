/**
 * Links project PDFs to a property value through StreamBIM's own attachments.
 *
 * One attachment on a "virtual object" covers every element with that value:
 *   parent-ifc-object.id = base64url(utf8("ifcelement~BIP~TypeID~str~FO03"))
 *
 * createLinkBackend() returns the same interface in live and mock mode.
 * The mock is tested on localhost. The live backend follows the API docs but
 * has NOT been run against StreamBIM yet. Reading PDF bytes across origins is
 * the biggest open question: see readPdf in liveBackend.
 */

import { documents, folders, objects } from "./mock-data.js";

const CACHE_PREFIX = "pdf-text:";
const CACHE_MAX_CHARS = 500_000;
const SCAN_PAUSE_MS = 300;
const PAGE_SIZE = 100;

export const MIN_VALUE_LENGTH = 3;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const CONFIRM_ABOVE_COUNT = 25;
export const CONFIRM_ABOVE_BYTES = 200 * 1024 * 1024;

/* ---------- Pure helpers ---------- */

export function virtualObjectId(pset, property, value, valueType = "str") {
  const key = `ifcelement~${pset}~${property}~${valueType}~${value}`;
  let binary = "";
  for (const byte of new TextEncoder().encode(key)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The selectable parameters of one object. Handles both shapes seen in the docs:
 * flat "Pset~Prop" keys, and groups like { label: "BIP:", values: { TypeID: "FO03 : str" } }.
 */
export function parametersFromInfo(info) {
  const found = new Map();
  const add = (pset, property, rawValue, valueType = "str") => {
    if (!pset || !property || rawValue == null || typeof rawValue === "object") return;
    const value = String(rawValue).trim();
    if (!value) return;
    const key = `${pset}~${property}`;
    if (!found.has(key)) found.set(key, { key, pset, property, value, valueType });
  };

  const flat = (info && (info.properties || info.props)) || {};
  for (const [name, value] of Object.entries(flat)) {
    const split = name.indexOf("~");
    if (split > 0 && !name.startsWith("@")) {
      add(name.slice(0, split), name.slice(split + 1), value, typeof value === "string" ? "str" : "number");
    }
  }

  // Real records: { label: "BIP", content: { properties: [{ key, value, valueType }] } }.
  const groups = Array.isArray(info && info.groups) ? info.groups : [];
  for (const group of groups) {
    const pset = String((group && group.label) || "").replace(/:\s*$/, "").trim();
    const rows = group && group.content && Array.isArray(group.content.properties) ? group.content.properties : [];
    for (const row of rows) {
      if (row) add(pset, row.key, row.value, normalizeValueType(row.valueType));
    }
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key, "sv"));
}

function normalizeValueType(valueType) {
  const type = String(valueType || "str").toLowerCase();
  return ["str", "string", "text", "varchar"].includes(type) ? "str" : type;
}

/** What the record looks like, for the panel when no parameters were found. No values. */
export function describeInfoShape(info) {
  const groups = Array.isArray(info && info.groups) ? info.groups : [];
  return JSON.stringify({
    keys: Object.keys(info || {}),
    groups: groups.slice(0, 8).map((group) => ({
      label: group && group.label,
      keys: Object.keys(group || {}),
      contentKeys: Object.keys((group && group.content) || {}),
    })),
  });
}

function normalize(text) {
  return String(text).normalize("NFC").replace(/\s+/g, " ").trim();
}

function tokenPattern(value) {
  const escaped = normalize(value)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+");
  // Whole tokens only, so FO03 does not hit FO031. Lookarounds, because \b ignores å, ä and ö.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/** First hit per value and PDF: { value, page (1-based), snippet }. */
export function findValuesInPages(values, pages) {
  const hits = [];
  for (const value of values) {
    const pattern = tokenPattern(value);
    for (let index = 0; index < pages.length; index += 1) {
      const match = pattern.exec(pages[index]);
      if (!match) continue;
      const start = Math.max(0, match.index - 40);
      const end = Math.min(pages[index].length, match.index + match[0].length + 40);
      const snippet = pages[index].slice(start, end).trim();
      hits.push({
        value,
        page: index + 1,
        snippet: `${start > 0 ? "…" : ""}${snippet}${end < pages[index].length ? "…" : ""}`,
      });
      break;
    }
  }
  return hits;
}

export function scanNeedsConfirmation(docs) {
  const bytes = docs.reduce((sum, doc) => sum + (doc.filesize || 0), 0);
  return docs.length > CONFIRM_ABOVE_COUNT || bytes > CONFIRM_ABOVE_BYTES;
}

export function isLinkableValue(value) {
  return normalize(value).length >= MIN_VALUE_LENGTH;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Text items from pdf.js to page text. Close items stay joined, so "FO" + "03" reads FO03. */
export function itemsToText(items) {
  let text = "";
  let previous = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (previous) {
      const sameLine = Math.abs(item.transform[5] - previous.transform[5]) < 1;
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      const tight = sameLine && Math.abs(gap) < Math.abs(item.transform[3] || 10) * 0.15;
      if (previous.hasEOL || !tight) text += " ";
    }
    text += item.str;
    previous = item;
  }
  return normalize(text);
}

/* ---------- PDF text ---------- */

let pdfjsPromise;

function loadPdfjs() {
  if (!pdfjsPromise) {
    const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href);
    pdfjsPromise = import(/* @vite-ignore */ new URL("pdf.min.mjs", base).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", base).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function extractPages(bytes) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function readCache(doc) {
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${doc.id}-${doc.revision}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(doc, pages) {
  try {
    if (pages.join("").length > CACHE_MAX_CHARS) return;
    window.localStorage.setItem(`${CACHE_PREFIX}${doc.id}-${doc.revision}`, JSON.stringify(pages));
  } catch {
    /* Storage full or blocked. The next scan reads the PDF again. */
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scans PDFs one at a time. Never throws for one bad PDF: it lands in `failed`.
 * @returns {Promise<{ hits: object[], noText: object[], failed: object[], skipped: object[], cancelled: boolean }>}
 */
export async function scanDocuments(backend, docs, values, { onProgress, isCancelled }) {
  const result = { hits: [], noText: [], failed: [], skipped: [], cancelled: false };
  for (let index = 0; index < docs.length; index += 1) {
    if (isCancelled()) {
      result.cancelled = true;
      break;
    }
    const doc = docs[index];
    onProgress(index, docs.length, doc);
    if (doc.filesize > MAX_PDF_BYTES) {
      result.skipped.push(doc);
      continue;
    }
    let pages = readCache(doc);
    if (!pages) {
      try {
        pages = await extractPages(await backend.readPdf(doc));
        writeCache(doc, pages);
        await wait(SCAN_PAUSE_MS);
      } catch (error) {
        result.failed.push({ doc, reason: messageOf(error) });
        continue;
      }
    }
    if (!pages.join("").trim()) {
      result.noText.push(doc);
      continue;
    }
    for (const hit of findValuesInPages(values, pages)) result.hits.push({ ...hit, doc });
  }
  onProgress(docs.length, docs.length, null);
  return result;
}

export function messageOf(error) {
  if (error && error.message) return error.message;
  if (error && error.debug) return String(error.debug);
  return String(error);
}

/**
 * Saves one link and reports what actually happened. Reads back instead of trusting the
 * POST, because a 201 reaches a widget as DataCloneError even when the write landed.
 * @returns {Promise<"linked"|"exists"|"failed">}
 */
export async function saveLink(backend, parameter, value, doc) {
  const before = await backend.listLinks(parameter, value);
  if (before.some((link) => link.documentId === doc.id)) return "exists";
  try {
    await backend.addLink(parameter, value, doc);
  } catch {
    /* Decided by the read below. Never retry a write blindly. */
  }
  const after = await backend.listLinks(parameter, value);
  return after.some((link) => link.documentId === doc.id) ? "linked" : "failed";
}

/* ---------- Backends ---------- */

export function createLinkBackend(client) {
  return client.mode === "live" ? liveBackend(client.api) : mockBackend();
}

function mockBackend() {
  /** Lives in memory, so a reload clears the links. */
  const attachments = [];
  let nextId = 1;
  const fileOf = (doc) => `${import.meta.env.BASE_URL}mock-pdfs/${encodeURIComponent(doc.filename)}`;

  return {
    async objectRecord() {
      return null;
    },
    async valuesFor(parameter) {
      const counts = {};
      for (const object of objects) {
        const value = object.props[parameter.key];
        if (value != null) counts[value] = (counts[value] || 0) + 1;
      }
      return counts;
    },
    async listFolders() {
      return folders.map((folder) => ({ ...folder }));
    },
    async listPdfs(folderId) {
      return documents
        .filter((doc) => !folderId || doc.folderId === folderId)
        .map((doc) => ({ ...doc }));
    },
    async readPdf(doc) {
      const response = await fetch(fileOf(doc));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    async listLinks(parameter, value) {
      const id = virtualObjectId(parameter.pset, parameter.property, value, parameter.valueType);
      return attachments.filter((item) => item.objectId === id).map((item) => ({ ...item }));
    },
    async addLink(parameter, value, doc) {
      attachments.push({
        id: String(nextId++),
        objectId: virtualObjectId(parameter.pset, parameter.property, value, parameter.valueType),
        documentId: doc.id,
        filename: doc.filename,
      });
    },
    async removeLink(link) {
      const index = attachments.findIndex((item) => item.id === link.id);
      if (index >= 0) attachments.splice(index, 1);
    },
    async documentUrl(link) {
      const doc = documents.find((item) => item.id === link.documentId);
      return new URL(fileOf(doc), window.location.href).href;
    },
  };
}

function liveBackend(api) {
  let contextPromise;
  const context = () => {
    if (!contextPromise) {
      contextPromise = Promise.all([api.getProjectId(), api.getBuildingId()]).then(([projectId, buildingId]) => ({
        projectId,
        buildingId,
        base: `/project-${projectId}/api/v1`,
      }));
    }
    return contextPromise;
  };

  async function request(path, { method = "GET", body, accept, contentType } = {}) {
    const options = { url: path, method };
    if (body !== undefined) options.body = body;
    if (accept) options.accept = accept;
    if (contentType) options.contentType = contentType;
    let text;
    try {
      text = await api.makeApiRequest(options);
    } catch (error) {
      if (/could not be cloned/.test(messageOf(error))) {
        throw new Error(`${method} ${path} misslyckades (status syns inte i widgetar)`);
      }
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function listAllDocuments(base, filters) {
    const rows = [];
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const { data } = await request(`${base}/v2/documents?${filters}page[limit]=${PAGE_SIZE}&page[skip]=${skip}`);
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  const origin = () => window.location.ancestorOrigins?.[0] || "https://app.streambim.com";

  async function microtoken(base) {
    const body = await request(`${base}/microtoken`, { accept: "application/json" });
    return body.microtoken;
  }

  return {
    /** getObjectInfo is the viewer's copy. The REST record has the property sets. */
    async objectRecord(guid) {
      const { base, buildingId } = await context();
      const { data } = await request(`${base}/v2/ifc-objects/${encodeURIComponent(guid)}?building=${buildingId}`);
      return data.attributes;
    },
    async valuesFor(parameter) {
      return api.valuesForObjectProperty(parameter.key);
    },
    async listFolders() {
      const { base } = await context();
      const { data } = await request(`${base}/v2/folders`);
      return data
        .filter((folder) => !folder.attributes["is-deleted"])
        .map((folder) => ({ id: folder.id, name: folder.attributes.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));
    },
    /**
     * Server-side filters first, because they need fewer requests. The filtered call failed in
     * project 19513 while the docs' sweep shows the plain list working, so fall back to paging
     * everything and filtering here. The checks below run either way.
     */
    async listPdfs(folderId) {
      const { base } = await context();
      const folder = folderId ? `&filter[folderId]=${folderId}` : "";
      let rows;
      try {
        rows = await listAllDocuments(base, `filter[fileExtensions]=pdf${folder}&`);
      } catch (error) {
        console.warn("Filtered document list failed, listing all documents", error);
        rows = await listAllDocuments(base, "");
      }
      return rows
        .filter((doc) => !doc.attributes["is-deleted"] && /\.pdf$/i.test(doc.attributes.filename || ""))
        .filter((doc) => !folderId || doc.relationships?.parent?.data?.id === folderId)
        .map((doc) => ({
          id: doc.id,
          filename: doc.attributes.filename,
          filesize: doc.attributes.filesize,
          revision: doc.attributes.revision,
          folderId: doc.relationships?.parent?.data?.id,
        }));
    },
    /**
     * NOT VERIFIED LIVE. makeApiRequest returns a string, which corrupts binary, so this has
     * to be a plain fetch with a microtoken, and StreamBIM's CORS rules decide if it works.
     */
    async readPdf(doc) {
      const { base } = await context();
      const link = await request(`${base}/documents/${doc.id}/downloadlink`, { accept: "application/json" });
      const path = String(link && link.data ? link.data : link).replace(/^\/+/, "");
      const separator = path.includes("?") ? "&" : "?";
      const token = /[?&](microtoken|token)=/.test(path) ? "" : `${separator}microtoken=${await microtoken(base)}`;
      const response = await fetch(`${origin()}${base}/${path}${token}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    async listLinks(parameter, value) {
      const { base, buildingId } = await context();
      const id = virtualObjectId(parameter.pset, parameter.property, value, parameter.valueType);
      const { data } = await request(
        `${base}/v2/attachments?filter[object]=${encodeURIComponent(id)}&filter[building]=${buildingId}`,
      );
      return data
        .filter((item) => !item.attributes["is-deleted"] && item.relationships?.["linked-document"]?.data)
        .map((item) => ({
          id: item.id,
          objectId: id,
          documentId: item.relationships["linked-document"].data.id,
          filename: item.attributes.filename,
        }));
    },
    async addLink(parameter, value, doc) {
      const { base } = await context();
      const id = virtualObjectId(parameter.pset, parameter.property, value, parameter.valueType);
      await request(`${base}/v2/attachments`, {
        method: "POST",
        body: {
          data: {
            type: "attachments",
            attributes: { category: "document", url: null },
            relationships: {
              "parent-ifc-object": { data: { id, type: "ifc-object" } },
              "linked-document": { data: { type: "documents", id: doc.id } },
              "parent-topic": { data: null },
              "parent-topic-comment": { data: null },
              "parent-topic-viewpoint": { data: null },
              "parent-workflow": { data: null },
              "parent-checklist-item": { data: null },
              "parent-checklist-item-instance": { data: null },
              "parent-project": { data: null },
              "parent-checklist": { data: null },
              "parent-topic-report-template": { data: null },
            },
          },
        },
      });
    },
    async removeLink(link) {
      const { base } = await context();
      await request(`${base}/v2/attachments/${link.id}`, { method: "DELETE" });
    },
    async documentUrl(link) {
      const { base } = await context();
      return `${origin()}${base}/documents/${link.documentId}/_show?microtoken=${await microtoken(base)}`;
    },
  };
}
