#!/usr/bin/env python3
"""Convert docs/功能介绍.md to PDF via HTML + Chrome/Edge headless."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
MD_FILE = DOCS / "功能介绍.md"
HTML_FILE = DOCS / "功能介绍.html"
PDF_FILE = DOCS / "功能介绍.pdf"

CHROME_CANDIDATES = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>Takealot ERP 功能介绍</title>
<style>
  @page {{ margin: 16mm 14mm 18mm 14mm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 10pt;
    line-height: 1.6;
    color: #2a3034;
    margin: 0;
    padding: 0;
  }}
  h1 {{
    font-size: 20pt;
    color: #1a1d26;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 8px;
    margin: 0 0 10px;
    page-break-after: avoid;
  }}
  h2 {{
    font-size: 13pt;
    color: #1e3a5f;
    margin: 20px 0 8px;
    padding-left: 10px;
    border-left: 4px solid #2563eb;
    page-break-after: avoid;
  }}
  h3 {{
    font-size: 11pt;
    color: #374151;
    margin: 14px 0 6px;
    page-break-after: avoid;
  }}
  p {{ margin: 6px 0; }}
  blockquote {{
    margin: 8px 0;
    padding: 6px 12px;
    background: #eff6ff;
    border-left: 4px solid #2563eb;
    color: #4b5563;
    font-size: 9.5pt;
  }}
  hr {{
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 14px 0;
  }}
  pre {{
    background: #1f2937;
    color: #e5e7eb;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 8.5pt;
    line-height: 1.5;
    page-break-inside: avoid;
    white-space: pre-wrap;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 12px;
    font-size: 9pt;
    page-break-inside: avoid;
  }}
  th {{
    background: #eff6ff;
    color: #1e40af;
    font-weight: 600;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid #dbeafe;
  }}
  td {{
    padding: 5px 8px;
    border: 1px solid #e5e7eb;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{ background: #f9fafb; }}
  strong {{ color: #111827; }}
  .cover-meta {{
    color: #6b7280;
    font-size: 9.5pt;
    margin-bottom: 16px;
  }}
  .footer-note {{
    margin-top: 20px;
    font-size: 9pt;
    color: #9ca3af;
    font-style: italic;
  }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def simple_md_to_html(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    in_code = False
    table_rows: list[list[str]] = []

    def flush_table() -> None:
        nonlocal table_rows
        if not table_rows:
            return
        out.append("<table>")
        for ri, row in enumerate(table_rows):
            tag = "th" if ri == 0 else "td"
            out.append("<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in row) + "</tr>")
        out.append("</table>")
        table_rows = []

    def inline(text: str) -> str:
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
        return text

    while i < len(lines):
        line = lines[i]

        if line.strip().startswith("```"):
            if in_code:
                out.append("</pre>")
                in_code = False
            else:
                out.append("<pre>")
                in_code = True
            i += 1
            continue

        if in_code:
            out.append(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            i += 1
            continue

        if re.match(r"^\|.+\|$", line.strip()):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.match(r"^:?-+:?$", c.replace(" ", "")) for c in cells):
                i += 1
                continue
            table_rows.append(cells)
            i += 1
            continue
        else:
            flush_table()

        if line.strip() == "---":
            out.append("<hr />")
        elif line.startswith("# "):
            out.append(f"<h1>{inline(line[2:].strip())}</h1>")
        elif line.startswith("## "):
            out.append(f"<h2>{inline(line[3:].strip())}</h2>")
        elif line.startswith("### "):
            out.append(f"<h3>{inline(line[4:].strip())}</h3>")
        elif line.startswith("> "):
            out.append(f"<blockquote><p>{inline(line[2:].strip())}</p></blockquote>")
        elif line.strip() == "":
            pass
        elif line.strip().startswith("*") and line.strip().endswith("*"):
            out.append(f'<p class="footer-note">{inline(line.strip().strip("*"))}</p>')
        else:
            out.append(f"<p>{inline(line.strip())}</p>")

        i += 1

    flush_table()
    if in_code:
        out.append("</pre>")

    html = "\n".join(out)
    html = re.sub(
        r"(<h1>Takealot ERP 功能介绍</h1>\s*)<blockquote><p>(版本：[^<]+)</p></blockquote>",
        r"\1<p class=\"cover-meta\">\2</p>",
        html,
        count=1,
    )
    html = re.sub(
        r"<blockquote><p>(状态说明：[^<]+)</p></blockquote>",
        r'<p class="cover-meta">\1</p>',
        html,
        count=1,
    )
    return html


def find_browser() -> Path:
    for p in CHROME_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError("未找到 Chrome 或 Edge，无法生成 PDF")


def main() -> int:
    if not MD_FILE.exists():
        print(f"找不到源文件: {MD_FILE}", file=sys.stderr)
        return 1

    md = MD_FILE.read_text(encoding="utf-8")
    body = simple_md_to_html(md)
    html = HTML_TEMPLATE.format(body=body)
    HTML_FILE.write_text(html, encoding="utf-8")
    print(f"已生成 HTML: {HTML_FILE}")

    browser = find_browser()
    html_uri = HTML_FILE.as_uri()
    cmd = [
        str(browser),
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF_FILE}",
        html_uri,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr or result.stdout, file=sys.stderr)
        return result.returncode

    if not PDF_FILE.exists():
        print("PDF 未生成", file=sys.stderr)
        return 1

    size_kb = PDF_FILE.stat().st_size // 1024
    print(f"已生成 PDF: {PDF_FILE} ({size_kb} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

