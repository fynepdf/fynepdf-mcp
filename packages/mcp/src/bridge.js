import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CompleteRequestSchema,
  CompleteResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createLocalTools, defaultDownloadDir, LOCAL_INSTRUCTIONS } from "./local-tools.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** Remote tools wait up to about 50 s for their job, so allow well over that. */
const CALL_TIMEOUT_MS = 120_000;

const KEY_HELP = "Get a key at https://fynepdf.com/developers/dashboard";

export function settingsFrom(env) {
  const apiKey = env.FYNEPDF_API_KEY?.trim();
  if (!apiKey) throw new Error(`Set FYNEPDF_API_KEY to a FynePDF API key. ${KEY_HELP}`);
  if (!/^fyne_(live|test)_/.test(apiKey)) throw new Error(`FYNEPDF_API_KEY isn't a FynePDF API key. ${KEY_HELP}`);
  const baseUrl = (env.FYNEPDF_BASE_URL || "https://api.fynepdf.com/v1").replace(/\/+$/, "");
  return {
    apiKey,
    baseUrl,
    mcpUrl: env.FYNEPDF_MCP_URL || new URL("/mcp", baseUrl).href,
    downloadDir: env.FYNEPDF_DOWNLOAD_DIR || defaultDownloadDir(),
    version: VERSION,
  };
}

export async function connectRemote({ apiKey, mcpUrl }) {
  const client = new Client({ name: "fynepdf-mcp", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": `fynepdf-mcp/${VERSION}` } },
  });
  await client.connect(transport);
  return client;
}

/** A stdio server that answers with the remote server's tools, resources and prompts, plus the local tools. */
export function createBridgeServer(remote, local) {
  const remoteCapabilities = remote.getServerCapabilities() ?? {};
  const remoteInfo = remote.getServerVersion();
  const capabilities = { tools: { listChanged: true } };
  if (remoteCapabilities.resources) capabilities.resources = { listChanged: true };
  if (remoteCapabilities.prompts) capabilities.prompts = { listChanged: true };
  if (remoteCapabilities.completions) capabilities.completions = {};

  const server = new Server(
    {
      name: "fynepdf",
      title: "FynePDF",
      version: VERSION,
      icons: remoteInfo?.icons,
      websiteUrl: remoteInfo?.websiteUrl ?? "https://fynepdf.com/developers/docs/mcp",
    },
    { capabilities, instructions: [remote.getInstructions(), LOCAL_INSTRUCTIONS].filter(Boolean).join("\n") },
  );

  const forward = (request, resultSchema, extra) =>
    remote.request({ method: request.method, params: request.params }, resultSchema, {
      signal: extra.signal,
      timeout: CALL_TIMEOUT_MS,
    });

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await forward(request, ListToolsResultSchema, extra);
    const tools = result.tools.filter((tool) => !local.has(tool.name));
    // The local tools go on the last page.
    return { ...result, tools: result.nextCursor ? tools : [...tools, ...local.tools] };
  });
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    local.has(request.params.name)
      ? local.call(request.params.name, request.params.arguments ?? {})
      : forward(request, CallToolResultSchema, extra),
  );
  remote.setNotificationHandler(ToolListChangedNotificationSchema, () => server.sendToolListChanged());

  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
      forward(request, ListResourcesResultSchema, extra),
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) =>
      forward(request, ListResourceTemplatesResultSchema, extra),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
      forward(request, ReadResourceResultSchema, extra),
    );
    remote.setNotificationHandler(ResourceListChangedNotificationSchema, () => server.sendResourceListChanged());
  }
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
      forward(request, ListPromptsResultSchema, extra),
    );
    server.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
      forward(request, GetPromptResultSchema, extra),
    );
    remote.setNotificationHandler(PromptListChangedNotificationSchema, () => server.sendPromptListChanged());
  }
  if (capabilities.completions) {
    server.setRequestHandler(CompleteRequestSchema, (request, extra) => forward(request, CompleteResultSchema, extra));
  }
  return server;
}

export async function run(env = process.env) {
  const settings = settingsFrom(env);
  let remote;
  try {
    remote = await connectRemote(settings);
  } catch (error) {
    throw new Error(`Couldn't reach ${settings.mcpUrl}: ${error.message}`);
  }
  const server = createBridgeServer(remote, createLocalTools(settings));
  const close = async () => {
    await server.close().catch(() => {});
    await remote.close().catch(() => {});
    process.exit(0);
  };
  // The client closing stdin is the signal to stop.
  process.stdin.on("end", close);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  await server.connect(new StdioServerTransport());
}
