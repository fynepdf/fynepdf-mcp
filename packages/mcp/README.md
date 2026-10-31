# @fynepdf/mcp

[FynePDF](https://fynepdf.com/developers/docs/mcp)'s MCP server over stdio, for assistants that work on files on your computer. It passes every tool through to the remote server at `https://api.fynepdf.com/mcp` with your API key, and adds two of its own:

- `upload_local_file`: sends a file on this computer to FynePDF and returns its `file_id` for the other tools.
- `download_file`: saves a result to your Downloads folder, or a folder or path you name. It never replaces an existing file unless `overwrite` is true.

Everything else (compress, merge, split, convert, OCR, redact, sign, create PDFs, ask and summarize) is the remote server's 24 tools, unchanged.

Name the file by its path ("compress ~/Downloads/report.pdf"). A file attached to the chat goes to the assistant's own sandbox, not your computer, so the bridge can't read it.

## Set it up

Get an API key in the [developer dashboard](https://fynepdf.com/developers/dashboard). Test keys are free (results are watermarked); live keys get 250 free credits a month.

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`), Windsurf, Cline and most other clients take this:

```json
{
  "mcpServers": {
    "fynepdf": {
      "command": "npx",
      "args": ["-y", "@fynepdf/mcp"],
      "env": { "FYNEPDF_API_KEY": "fyne_live_..." }
    }
  }
}
```

Claude Code:

```bash
claude mcp add fynepdf --env FYNEPDF_API_KEY=fyne_live_... -- npx -y @fynepdf/mcp
```

Needs Node.js 20 or newer.

## Settings

| Variable | |
|---|---|
| `FYNEPDF_API_KEY` | Required. A live or test key. |
| `FYNEPDF_DOWNLOAD_DIR` | Where `download_file` saves by default. Your Downloads folder if it exists, else your home folder. |
| `FYNEPDF_BASE_URL` | The REST API. Default `https://api.fynepdf.com/v1`. |
| `FYNEPDF_MCP_URL` | The remote MCP server. Default: `/mcp` on the API's host. |

## Remote or local?

If your assistant can add a remote MCP server (Claude, ChatGPT, Cursor, VS Code, Claude Code), you don't need this package: add `https://api.fynepdf.com/mcp`, sign in, and work counts against your fynepdf.com plan with no key. Use the bridge when the files are on your computer, when your client only runs local servers, or when you'd rather pay with API credits.

Your key goes only to `api.fynepdf.com`. Uploads over 25 MB and all downloads go straight to storage through signed links, without the key. Files are deleted from FynePDF after 24 hours unless you save them to your Library.

## License

MIT
