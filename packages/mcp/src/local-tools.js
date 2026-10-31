import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

/** Files up to this size go in the request body; bigger ones go to storage through an upload URL. */
const MULTIPART_LIMIT = 25 * 1024 * 1024;

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  epub: "application/epub+zip",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
};

const contentTypeOf = (filename) =>
  CONTENT_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Where assistants keep a file attached to the chat: their own code sandbox (Claude, ChatGPT), not this computer. */
const SANDBOX_PATH = /^\/(home\/claude|mnt\/user-data|mnt\/data)(\/|$)/;

export const LOCAL_INSTRUCTIONS =
  "This connection runs on the person's computer. To work on a file from it, call upload_local_file with the file's full path (not upload_file). A file attached to the chat stays in your own sandbox, which this computer can't read: ask the person where the file is on their computer instead. To hand a result back, call download_file with its file_id: it saves the file to their Downloads folder and says where.";

const TOOLS = [
  {
    name: "upload_local_file",
    title: "Upload a file from this computer",
    description:
      "Send a file on this computer to FynePDF and get a file_id for the other tools. Use it instead of upload_file whenever the file is on this computer. Paths in your own sandbox (/home/claude, /mnt/user-data, /mnt/data) aren't on this computer. PDFs, Office files, images, EPUB, HTML, Markdown and text.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's full path on this computer. ~ is the home folder." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        filename: { type: "string" },
        bytes: { type: ["number", "null"] },
        pages: { type: ["number", "null"] },
        expires_at: { type: "string" },
      },
      required: ["file_id", "filename"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "download_file",
    title: "Save a file to this computer",
    description:
      "Save a FynePDF file (the file_id from any tool's result) to this computer and say where it went. Saves to the Downloads folder unless a path is given, and never replaces an existing file unless overwrite is true.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", pattern: "^file_", description: "The file_id to save." },
        path: {
          type: "string",
          description: "A folder, or a full path with the file name. Leave it out for the Downloads folder.",
        },
        overwrite: { type: "boolean", description: "Replace a file already at that path. Default false." },
      },
      required: ["file_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { path: { type: "string" }, bytes: { type: "number" } },
      required: ["path", "bytes"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

/** A message for the assistant: the call went wrong in a way it can fix or explain. */
class ToolError extends Error {}

export function defaultDownloadDir() {
  const downloads = join(homedir(), "Downloads");
  return existsSync(downloads) ? downloads : homedir();
}

function expandPath(path) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

/** "report.pdf" -> "report (1).pdf", the way browsers name a second download. */
function numbered(path, n) {
  const ext = extname(path);
  return `${path.slice(0, path.length - ext.length)} (${n})${ext}`;
}

async function isDirectory(path) {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

/**
 * The local tools, which talk to the REST API with the same key the remote server gets.
 * @param {{ apiKey: string, baseUrl: string, downloadDir: string, version: string, fetchImpl?: typeof fetch }} settings
 */
export function createLocalTools({ apiKey, baseUrl, downloadDir, version, fetchImpl = fetch }) {
  async function api(method, path, { body, form } = {}) {
    const headers = { Authorization: `Bearer ${apiKey}`, "User-Agent": `fynepdf-mcp/${version}` };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ToolError(data.detail ?? data.title ?? `FynePDF answered ${response.status}.`);
    return data;
  }

  async function upload({ path }) {
    const full = expandPath(path);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile() && SANDBOX_PATH.test(path.trim())) {
      throw new ToolError(
        `${path.trim()} is in your own sandbox, not on this computer: files attached to the chat don't reach this connection. Ask the person where the file is on their computer (their Downloads folder is ${downloadDir}), then call upload_local_file with that path.`,
      );
    }
    if (!info?.isFile()) throw new ToolError(`There's no file at ${full}.`);
    const filename = basename(full);
    const type = contentTypeOf(filename);
    const bytes = new Uint8Array(await readFile(full));

    let file;
    if (bytes.byteLength <= MULTIPART_LIMIT) {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), filename);
      file = await api("POST", "/files", { form });
    } else {
      // Large files go straight to storage: an upload URL, a PUT, then the file.
      const created = await api("POST", "/files", {
        body: { filename, size: bytes.byteLength, content_type: type },
      });
      const put = await fetchImpl(created.upload_url, {
        method: "PUT",
        headers: { "Content-Type": created.content_type ?? type },
        body: bytes,
      });
      if (!put.ok) throw new ToolError(`The upload to storage failed (${put.status}).`);
      file = await api("GET", `/files/${encodeURIComponent(created.id)}`);
    }
    return {
      file_id: file.id,
      filename: file.filename,
      bytes: file.bytes,
      pages: file.pages,
      expires_at: file.expires_at,
    };
  }

  async function targetFor(path, filename, overwrite) {
    let target = join(downloadDir, filename);
    if (path) {
      const full = expandPath(path);
      const folder = path.endsWith("/") || path.endsWith(sep) || (await isDirectory(full)) || !extname(full);
      target = folder ? join(full, filename) : full;
    }
    if (overwrite || !existsSync(target)) return target;
    for (let n = 1; ; n++) {
      if (!existsSync(numbered(target, n))) return numbered(target, n);
    }
  }

  async function download({ file_id, path, overwrite = false }) {
    const file = await api("GET", `/files/${encodeURIComponent(file_id)}`);
    if (!file.download_url) throw new ToolError(`${file_id} is ${file.status}, so there's nothing to download.`);
    // A signed storage link: the key isn't sent there.
    const response = await fetchImpl(file.download_url);
    if (!response.ok) throw new ToolError(`The download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const target = await targetFor(path, basename(file.filename), overwrite);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: overwrite ? "w" : "wx" });
    return { path: target, bytes: bytes.byteLength };
  }

  const handlers = { upload_local_file: upload, download_file: download };

  return {
    tools: TOOLS,
    has: (name) => Object.hasOwn(handlers, name),
    async call(name, args) {
      try {
        const result = await handlers[name](args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const text = error instanceof ToolError ? error.message : `${name} failed: ${error.message}`;
        return { content: [{ type: "text", text }], isError: true };
      }
    },
  };
}
