<p align="center">
  <img src="icon.png" width="96" height="96" alt="FynePDF">
</p>

<h1 align="center">FynePDF MCP server</h1>

<p align="center">
  Real PDF tools for Claude, ChatGPT, Cursor, VS Code and any other MCP client:<br>
  compress, merge, split, convert, OCR, redact, sign, create PDFs, and read them with AI.
</p>

```text
https://api.fynepdf.com/mcp
```

FynePDF is a remote MCP server (Streamable HTTP). Add the URL to an assistant once, sign in with your FynePDF account, and it can work on PDFs itself: "compress this to under 5 MB", "redact every phone number", "turn these invoices into a spreadsheet".

This repository holds the server's registry entry, the local bridge (`npx @fynepdf/mcp`) and a Claude skill. The server itself runs at FynePDF; docs are at [fynepdf.com/developers/docs/mcp](https://fynepdf.com/developers/docs/mcp).

## Connect it

| Assistant | How |
|---|---|
| Claude (web, desktop, mobile) | Settings, Connectors, Add custom connector, paste the URL. [Guide](https://fynepdf.com/developers/docs/mcp/claude) |
| ChatGPT | Turn on Developer mode in Settings, Apps, then create an app with the URL. [Guide](https://fynepdf.com/developers/docs/mcp/chatgpt) |
| Cursor | [Add to Cursor](https://fynepdf.com/developers/docs/mcp/cursor) |
| VS Code | [Add to VS Code](https://fynepdf.com/developers/docs/mcp/vscode) |
| Claude Code | `claude mcp add --transport http fynepdf https://api.fynepdf.com/mcp` |

Any client that speaks remote MCP works the same way: give it the URL, and it signs in with OAuth the first time a tool needs your account. Work then counts against your fynepdf.com plan, as on the website. Agents of your own can send an [API key](https://fynepdf.com/developers/docs/authentication) as the bearer token instead; that spends API credits.

## Local files: `npx @fynepdf/mcp`

A remote server can't see files on your computer. The bridge runs on your machine over stdio, passes everything through to the remote server with your API key, and adds two tools of its own:

- `upload_local_file`: sends a file on this computer to FynePDF and returns its `file_id`.
- `download_file`: saves a result to your Downloads folder (or a path you name). It never replaces an existing file unless told to.

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

Get a key in the [developer dashboard](https://fynepdf.com/developers/dashboard): test keys are free (results are watermarked), live keys get 250 free credits a month. More in [packages/mcp](packages/mcp).

## Tools

| Tool | What it does |
|---|---|
| `upload_file` | Bring a file in: a drop zone in Claude, ChatGPT and VS Code, or a signed upload link |
| `import_file_from_url` | Fetch a PDF, Office file, image or EPUB from a public link |
| `get_file` | A file's details and a fresh download link |
| `list_library_files`, `save_to_library` | Use and keep files in your FynePDF Library |
| `merge_pdfs`, `split_pdf`, `edit_pages` | Join, split, delete, keep, reorder and rotate pages |
| `stamp_pdf` | Page numbers, a watermark, or both |
| `compress_pdf` | Smaller at a level, or under a target size |
| `protect_pdf` | Lock with a password, unlock, or flatten |
| `redact_pdf` | Remove text for real: exact text, or described ("all names and emails") |
| `convert_from_pdf` | To Word, Excel or CSV, images, Markdown, EPUB, PDF/A, LaTeX or grayscale |
| `convert_to_pdf` | From Word, Excel, PowerPoint, images, EPUB or a web page |
| `ocr_pdf` | Make a scan searchable |
| `create_pdf` | A report, invoice, letter or resume from Markdown, HTML or data, with the figures checked |
| `sign_pdf` | Stamp a signature image on a page |
| `ask_pdf`, `summarize_pdf` | Answers and summaries citing pages, with quotes checked against the text |
| `extract_data` | Invoices, statements and tables as data, added up in code |
| `smart_edit` | Describe the change; FynePDF plans the steps and runs them |
| `get_job`, `search_docs`, `list_actions` | Long jobs, the docs, and every action with its price |

Every tool returns a `file_id`, so the next tool works on the result without downloading and uploading again. In Claude and ChatGPT a result also shows as a card with a preview, Download and Save to Library.

## Files and privacy

Files live on FynePDF only while they're worked on: they're deleted after 24 hours unless you save them to your Library, and download links last 1 hour. Disconnect an assistant any time in the [dashboard](https://fynepdf.com/developers/dashboard?section=assistants); it stops working at once. See the [privacy policy](https://fynepdf.com/privacy).

## Also here

- [`server.json`](server.json): the entry in the [MCP Registry](https://registry.modelcontextprotocol.io) as `com.fynepdf/fynepdf`.
- [`skills/fynepdf`](skills/fynepdf): a Claude skill that teaches the tools' good habits.
- [`postman`](postman): a Postman collection for the REST API.

Prefer code? The [REST API](https://fynepdf.com/developers/docs) has the same actions, with SDKs for [Node](https://www.npmjs.com/package/fynepdf) and [Python](https://pypi.org/project/fynepdf/).

## License

MIT
