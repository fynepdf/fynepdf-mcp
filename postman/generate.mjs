// Builds the Postman collection from FynePDF's OpenAPI document.
// node postman/generate.mjs [openapi.json path or URL]
import { readFile, writeFile } from "node:fs/promises";

const source = process.argv[2] ?? "https://fynepdf.com/developers/openapi.json";
const spec = JSON.parse(
  /^https?:/.test(source) ? await (await fetch(source)).text() : await readFile(source, "utf8"),
);

const EXAMPLE_FILES = ["file_01jc8x4m2k9q7r3t5vwy6z", "file_01jc8x5n7p2s4u6w8y0a1b"];
const ID_VARIABLE = { "/files/": "fileId", "/jobs/": "jobId" };
const METHODS = ["get", "post", "put", "patch", "delete"];

/** The id a response gives, kept for the next request: an upload's file, a job's id. */
function keepId(variable, condition) {
  return {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const body = pm.response.json();",
        `if (${condition}) pm.collectionVariables.set("${variable}", body.id);`,
      ],
    },
  };
}

function url(path, operation) {
  const segments = path.replace(/^\//, "").split("/");
  const variable = Object.entries(ID_VARIABLE).find(([prefix]) => path.startsWith(prefix))?.[1];
  const query = (operation.parameters ?? [])
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => ({ key: parameter.name, value: "", disabled: true, description: parameter.description }));
  return {
    raw: `{{baseUrl}}/${segments.map((segment) => segment.replace(/^\{(\w+)\}$/, ":$1")).join("/")}`,
    host: ["{{baseUrl}}"],
    path: segments.map((segment) => segment.replace(/^\{(\w+)\}$/, ":$1")),
    ...(query.length ? { query } : {}),
    ...(path.includes("{id}") ? { variable: [{ key: "id", value: `{{${variable}}}` }] } : {}),
  };
}

function jsonBody(example) {
  let raw = JSON.stringify(example ?? {}, null, 2);
  // The examples' file ids become the file you uploaded.
  raw = raw.replaceAll(EXAMPLE_FILES[0], "{{fileId}}").replaceAll(EXAMPLE_FILES[1], "{{secondFileId}}");
  return { mode: "raw", raw, options: { raw: { language: "json" } } };
}

function request(path, method, operation, body, extra = {}) {
  const header = [];
  if (body?.mode === "raw") header.push({ key: "Content-Type", value: "application/json" });
  if (method === "post") {
    header.push({
      key: "Idempotency-Key",
      value: "{{$guid}}",
      description: "A retry with the same key never runs or charges twice.",
    });
  }
  const events = [];
  if (operation.tags?.includes("Shortcuts") || operation.tags?.includes("AI") || path === "/jobs") {
    if (method === "post" && !path.endsWith("/quote")) events.push(keepId("jobId", 'body.object === "job"'));
  }
  if (path === "/files" && method === "post") events.push(keepId("fileId", 'body.object === "file"'));
  return {
    name: extra.name ?? operation.summary ?? operation.operationId,
    ...(events.length ? { event: events } : {}),
    request: {
      method: method.toUpperCase(),
      header,
      ...(body ? { body } : {}),
      url: url(path, operation),
      description: extra.description ?? operation.description,
    },
  };
}

const folders = new Map(spec.tags.map((tag) => [tag.name, { name: tag.name, description: tag.description, item: [] }]));

for (const [path, operations] of Object.entries(spec.paths)) {
  // In the document's order, so uploading comes before listing.
  for (const [method, operation] of Object.entries(operations).filter(([key]) => METHODS.includes(key))) {
    const folder = folders.get(operation.tags?.[0] ?? "Account");
    const content = operation.requestBody?.content ?? {};

    if (content["multipart/form-data"]) {
      folder.item.push(
        request(
          path,
          method,
          operation,
          {
            mode: "formdata",
            formdata: [{ key: "file", type: "file", src: [], description: "Pick a PDF, up to 25 MB in the request." }],
          },
          { name: "Upload a file", description: "Send the file in the request body (up to 25 MB)." },
        ),
      );
    }
    if (content["application/json"]) {
      const name = content["multipart/form-data"] ? "Add a file from a URL" : undefined;
      folder.item.push(request(path, method, operation, jsonBody(content["application/json"].example), { name }));
    } else if (!content["multipart/form-data"]) {
      folder.item.push(request(path, method, operation));
    }
  }
}

const collection = {
  info: {
    name: "FynePDF API",
    description: [
      "Compress, convert, OCR, redact, merge, split and generate PDFs, and read them with AI.",
      "",
      "1. Get a key at https://fynepdf.com/developers/dashboard (test keys are free; results are watermarked).",
      "2. Set the collection's `apiKey` variable.",
      '3. Run **Files, Upload a file**: the file id is kept as `fileId` for every other request.',
      "",
      "Docs: https://fynepdf.com/developers/docs",
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] },
  variable: [
    { key: "baseUrl", value: spec.servers[0].url },
    { key: "apiKey", value: "", description: "fyne_live_… or fyne_test_…" },
    { key: "fileId", value: "", description: "Set by Upload a file." },
    { key: "secondFileId", value: "", description: "A second file, for merge." },
    { key: "jobId", value: "", description: "Set by any request that starts a job." },
  ],
  item: [...folders.values()].filter((folder) => folder.item.length),
};

const out = new URL("./fynepdf.postman_collection.json", import.meta.url);
await writeFile(out, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`${collection.item.reduce((n, folder) => n + folder.item.length, 0)} requests in ${collection.item.length} folders`);
