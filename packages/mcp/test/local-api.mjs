// Runs the bridge against a real FynePDF API: FYNEPDF_API_KEY (a live key with credits) and FYNEPDF_BASE_URL.
// node test/local-api.mjs
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const downloads = await mkdtemp(join(tmpdir(), "fynepdf-mcp-local-"));
const client = new Client({ name: "local-api-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../bin/fynepdf-mcp.js", import.meta.url))],
    env: {
      ...getDefaultEnvironment(),
      FYNEPDF_API_KEY: process.env.FYNEPDF_API_KEY,
      FYNEPDF_BASE_URL: process.env.FYNEPDF_BASE_URL,
      FYNEPDF_DOWNLOAD_DIR: downloads,
    },
  }),
);

let failed = 0;
const check = (name, ok, detail = "") => {
  failed += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 150)})` : ""}`);
};
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  return { ...result.structuredContent, isError: result.isError, text: result.content[0]?.text };
};

const tools = (await client.listTools()).tools.map((tool) => tool.name);
check(
  "tools: the remote ones and the two local ones",
  ["create_pdf", "compress_pdf", "upload_file", "upload_local_file", "download_file"].every((name) => tools.includes(name)),
  `${tools.length} tools`,
);
check("instructions mention the local tools", /upload_local_file/.test(client.getInstructions() ?? ""));

const made = await call("create_pdf", { markdown: "# Bridge test\n\nMade through the stdio bridge.", title: "Bridge test" });
check("create_pdf (remote, with the API key)", made.status === "succeeded", made.files?.[0]?.filename);

const saved = await call("download_file", { file_id: made.files[0].file_id });
const savedBytes = await readFile(saved.path);
check("download_file: saved to the downloads folder", saved.path.startsWith(downloads) && savedBytes.subarray(0, 4).toString() === "%PDF", saved.path);

const uploaded = await call("upload_local_file", { path: saved.path });
check("upload_local_file: the saved file back up", uploaded.file_id?.startsWith("file_") && uploaded.bytes === savedBytes.byteLength, uploaded.file_id);

const compressed = await call("compress_pdf", { file_id: uploaded.file_id, level: "high" });
check("compress_pdf on the uploaded file", compressed.status === "succeeded", compressed.steps?.[0] && `${compressed.steps[0].bytes_before} -> ${compressed.steps[0].bytes_after}`);

const again = await call("download_file", { file_id: compressed.files[0].file_id, path: join(downloads, "compressed.pdf") });
check("download_file to a named path", again.path === join(downloads, "compressed.pdf") && (await readFile(again.path)).subarray(0, 4).toString() === "%PDF", again.path);

const missing = await call("upload_local_file", { path: join(downloads, "nope.pdf") });
check("upload_local_file: a missing file is a tool error", missing.isError === true, missing.text);

const unknown = await call("download_file", { file_id: "file_does_not_exist" });
check("download_file: an unknown file says so", unknown.isError === true, unknown.text);

const { resources } = await client.listResources();
const card = resources[0] && (await client.readResource({ uri: resources[0].uri }));
check("resources: the app cards come through", Boolean(card?.contents?.[0]?.text?.includes("<")), resources.map((r) => r.uri).join(" "));

await client.close();
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
