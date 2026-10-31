import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BIN = fileURLToPath(new URL("../bin/fynepdf-mcp.js", import.meta.url));
const KEY = `fyne_test_${"a".repeat(40)}`;
const OUTPUT = new TextEncoder().encode("%PDF-1.7 compressed");

/** Every request the fake FynePDF saw: method, path and the Authorization header. */
const seen = [];
let origin;
let http;
let client;
let downloads;
let uploadedBytes = 0;

function fakeRemote(auth) {
  const server = new Server(
    { name: "fynepdf", version: "1.0.0", icons: [{ src: "https://fynepdf.com/icon-192.png" }] },
    { capabilities: { tools: {}, resources: {} }, instructions: "Remote instructions." },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ["compress_pdf", "upload_file", "download_file"].map((name) => ({
      name,
      inputSchema: { type: "object" },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => ({
    content: [{ type: "text", text: JSON.stringify({ tool: request.params.name, args: request.params.arguments, auth }) }],
  }));
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{ uri: "ui://fynepdf/card.html", name: "card" }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => ({
    contents: [{ uri: request.params.uri, mimeType: "text/html;profile=mcp-app", text: "<p>card</p>" }],
  }));
  return server;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, origin);
  seen.push({ method: req.method, path: pathname, auth: req.headers.authorization });

  if (pathname === "/mcp") {
    if (req.method !== "POST") return res.writeHead(405).end();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await fakeRemote(req.headers.authorization).connect(transport);
    return transport.handleRequest(req, res);
  }
  if (req.method === "POST" && pathname === "/v1/files") {
    const body = await bodyOf(req);
    if (req.headers["content-type"].startsWith("multipart/form-data")) {
      const form = await new Request(`${origin}/`, { method: "POST", headers: req.headers, body }).formData();
      const file = form.get("file");
      return json(res, 201, { id: "file_small", filename: file.name, bytes: file.size, pages: 1, status: "ready" });
    }
    const { filename } = JSON.parse(body);
    return json(res, 201, { id: "file_big", filename, upload_url: `${origin}/storage/put`, content_type: "application/pdf" });
  }
  if (req.method === "PUT" && pathname === "/storage/put") {
    uploadedBytes = (await bodyOf(req)).byteLength;
    return res.writeHead(200).end();
  }
  if (pathname === "/v1/files/file_big") {
    return json(res, 200, { id: "file_big", filename: "big.pdf", bytes: uploadedBytes, pages: 3, status: "ready" });
  }
  if (pathname === "/v1/files/file_out") {
    return json(res, 200, {
      id: "file_out",
      filename: "report-small.pdf",
      status: "ready",
      download_url: `${origin}/storage/get`,
    });
  }
  if (pathname === "/v1/files/file_gone") {
    return json(res, 200, { id: "file_gone", filename: "old.pdf", status: "expired", download_url: null });
  }
  if (pathname === "/storage/get") return res.writeHead(200).end(OUTPUT);
  return json(res, 404, { code: "not_found", detail: "No such file." });
}

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text };
};

before(async () => {
  http = createServer((req, res) => handle(req, res).catch((error) => json(res, 500, { detail: error.message })));
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${http.address().port}`;
  downloads = await mkdtemp(join(tmpdir(), "fynepdf-mcp-"));
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: {
        ...getDefaultEnvironment(),
        FYNEPDF_API_KEY: KEY,
        FYNEPDF_BASE_URL: `${origin}/v1`,
        FYNEPDF_DOWNLOAD_DIR: downloads,
      },
    }),
  );
});

after(async () => {
  await client?.close();
  http?.close();
});

test("lists the remote tools and the local ones, once each", async () => {
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(names, ["compress_pdf", "upload_file", "upload_local_file", "download_file"]);
  assert.match(client.getInstructions(), /^Remote instructions\.\n.*upload_local_file/s);
  assert.match(client.getInstructions(), /attached to the chat stays in your own sandbox/);
  assert.equal(client.getServerVersion().name, "fynepdf");
  assert.equal(client.getServerVersion().icons[0].src, "https://fynepdf.com/icon-192.png");
});

test("forwards remote tools with the key as a bearer token", async () => {
  const { text } = await call("compress_pdf", { file_id: "file_1" });
  assert.deepEqual(JSON.parse(text), { tool: "compress_pdf", args: { file_id: "file_1" }, auth: `Bearer ${KEY}` });
});

test("forwards resources, so app cards still draw", async () => {
  const { contents } = await client.readResource({ uri: "ui://fynepdf/card.html" });
  assert.equal(contents[0].text, "<p>card</p>");
});

test("upload_local_file sends a small file in the request body", async () => {
  const path = join(downloads, "notes.pdf");
  await writeFile(path, "%PDF-1.4 notes");
  const result = await call("upload_local_file", { path });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { file_id: "file_small", filename: "notes.pdf", bytes: 14, pages: 1 });
  const upload = seen.findLast((request) => request.path === "/v1/files");
  assert.equal(upload.auth, `Bearer ${KEY}`);
});

test("upload_local_file sends a large file to storage without the key", async () => {
  const path = join(downloads, "big.pdf");
  await writeFile(path, Buffer.alloc(26 * 1024 * 1024, 48));
  const result = await call("upload_local_file", { path });
  assert.equal(result.structuredContent.file_id, "file_big");
  assert.equal(result.structuredContent.bytes, 26 * 1024 * 1024);
  assert.equal(seen.findLast((request) => request.path === "/storage/put").auth, undefined);
});

test("upload_local_file says when there's no file", async () => {
  const result = await call("upload_local_file", { path: join(downloads, "missing.pdf") });
  assert.equal(result.isError, true);
  assert.match(result.text, /There's no file at .*missing\.pdf/);
});

test("upload_local_file says a chat attachment's sandbox path isn't on this computer", async () => {
  // Claude Desktop, a PDF attached in Chat: the assistant passed its sandbox copy's path.
  for (const path of ["/home/claude/FynePDF-Sample.pdf", "/mnt/user-data/uploads/report.pdf", "/mnt/data/scan.pdf"]) {
    const result = await call("upload_local_file", { path });
    assert.equal(result.isError, true);
    assert.ok(result.text.startsWith(`${path} is in your own sandbox, not on this computer`), result.text);
    assert.ok(result.text.includes(`their Downloads folder is ${downloads}`), result.text);
  }
});

test("download_file saves to the downloads folder and never replaces a file", async () => {
  const first = await call("download_file", { file_id: "file_out" });
  assert.equal(first.structuredContent.path, join(downloads, "report-small.pdf"));
  assert.deepEqual(new Uint8Array(await readFile(first.structuredContent.path)), OUTPUT);
  assert.equal(seen.findLast((request) => request.path === "/storage/get").auth, undefined);

  const second = await call("download_file", { file_id: "file_out" });
  assert.equal(second.structuredContent.path, join(downloads, "report-small (1).pdf"));

  const replaced = await call("download_file", { file_id: "file_out", overwrite: true });
  assert.equal(replaced.structuredContent.path, join(downloads, "report-small.pdf"));
});

test("download_file takes a folder or a full path", async () => {
  const folder = await call("download_file", { file_id: "file_out", path: join(downloads, "out") });
  assert.equal(folder.structuredContent.path, join(downloads, "out", "report-small.pdf"));
  const named = await call("download_file", { file_id: "file_out", path: join(downloads, "final.pdf") });
  assert.equal(named.structuredContent.path, join(downloads, "final.pdf"));
});

test("download_file explains expired and unknown files", async () => {
  assert.match((await call("download_file", { file_id: "file_gone" })).text, /file_gone is expired/);
  const unknown = await call("download_file", { file_id: "file_x" });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.text, "No such file.");
});

test("without a key it stops and says where to get one", () => {
  const env = { ...process.env };
  delete env.FYNEPDF_API_KEY;
  const run = spawnSync(process.execPath, [BIN], { env, input: "", encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set FYNEPDF_API_KEY.*fynepdf\.com\/developers\/dashboard/);
});
