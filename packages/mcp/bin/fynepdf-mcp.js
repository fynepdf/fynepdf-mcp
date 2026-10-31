#!/usr/bin/env node
import { run } from "../src/bridge.js";

run().catch((error) => {
  console.error(`fynepdf-mcp: ${error.message}`);
  process.exit(1);
});
