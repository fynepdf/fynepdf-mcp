---
name: fynepdf
description: Work on PDFs with FynePDF's tools - compress, merge, split, convert, OCR, redact, sign, create invoices, reports, letters and resumes, and read PDFs with cited answers. Use when the FynePDF connector or MCP server is available and the person asks to change, convert, create or understand a PDF or Office file, or when code needs the FynePDF REST API.
---

# FynePDF

FynePDF's tools keep files on FynePDF between calls. Every tool takes a `file_id` and returns new ones, so chains of work never download and re-upload.

## Get the file in once

- **The person attached or dropped a file:** call `upload_file` and let them use its drop zone, or pass the attachment where the client hands files over (ChatGPT does).
- **The file is on this computer** (the local `npx @fynepdf/mcp` server): `upload_local_file` with the full path.
- **A public link:** `import_file_from_url`.
- **Their FynePDF Library:** `list_library_files`, then pass `library_file_id`.
- **A code sandbox or agent:** `upload_file` with `file_name` and `size_bytes` returns a signed `upload_url` and a ready `curl` command.

Then keep passing the `file_id` from each result to the next tool.

## Pick the tool that does the whole job

| They want | Use |
|---|---|
| Smaller | `compress_pdf` with `target_size_mb` when they name a size, else a `level`. The result says whether the target was met; if not, say so and offer `high`. |
| Several steps ("remove blank pages, number the rest, make it PDF/A") | `smart_edit` with their words as `instruction`. It plans and runs the steps in one job; `run: false` returns only the plan, to show first. |
| Join, split, reorder, rotate, delete pages | `merge_pdfs`, `split_pdf`, `edit_pages` |
| Page numbers, a watermark | `stamp_pdf` (both in one call) |
| Word, Excel, images, Markdown, EPUB, PDF/A, LaTeX, gray | `convert_from_pdf` |
| From Word, Excel, PowerPoint, images, EPUB, a web page | `convert_to_pdf` |
| Tables from a scan or a bank statement | `extract_data` (AI reads, code checks the sums), not `convert_from_pdf` |
| A scan they want to search or copy from | `ocr_pdf` |
| Remove names, numbers, emails for real | `redact_pdf`: the exact strings in `text` when they list them, a description in `find` when they don't. The text is removed from the result for good (the original is kept), so confirm what to remove when it's unclear. |
| An invoice, report, letter, resume | `create_pdf`. For an invoice give `data` with line items and let FynePDF add it up; if their own totals disagree it prints them and says which don't add up: tell them. |
| Questions, a summary | `ask_pdf`, `summarize_pdf`. Answers cite pages; quote the page numbers back. |
| Passwords, flatten forms | `protect_pdf` |
| A signature image on a page | `sign_pdf` |

Not sure an action exists or what it costs? `list_actions` and `search_docs` work without signing in.

## Hand the result back

- Share the result's `download_url`. It works for 1 hour; `get_file` makes a fresh one.
- With the local server, `download_file` saves it to their Downloads folder and returns the path: give them the path.
- Files are deleted after 24 hours. If they'll want it later, offer `save_to_library`.
- Say what changed in plain numbers from the result: "12.4 MB to 3.1 MB", "removed 14 matches on 6 pages", "3 of 40 pages had no text, so OCR added it".

## Long jobs

A tool waits about 50 seconds. A result with `status: "running"` has a `job_id`: call `get_job` with it, and tell the person it's still working rather than starting the job again.

## Accounts and limits

Signed in with a FynePDF account, tools use that account's plan, as on fynepdf.com. With an API key they spend credits. When a tool says a limit was reached or credits ran out, pass on its message and its link as they are; don't retry.

## Without the connector: the REST API

The same actions are a REST API at `https://api.fynepdf.com/v1` with a key in `Authorization: Bearer $FYNEPDF_API_KEY`:

```bash
curl https://api.fynepdf.com/v1/files -H "Authorization: Bearer $FYNEPDF_API_KEY" -F file=@report.pdf
curl https://api.fynepdf.com/v1/pdf/compress -H "Authorization: Bearer $FYNEPDF_API_KEY" \
  -H "Content-Type: application/json" -d '{"file_id": "file_...", "target_size_bytes": 5000000}'
```

In code, prefer the SDKs: `npm install fynepdf` or `pip install fynepdf`. Docs, with every action's parameters: https://fynepdf.com/developers/docs
