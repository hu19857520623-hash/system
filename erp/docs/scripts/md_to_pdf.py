#!/usr/bin/env python3
"""Convert docs/数据安全指南.md to PDF via HTML + Chrome headless."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
MD_FILE = DOCS / "数据安全指南.md"
HTML_FILE = DOCS / "数据安全指南.html"
PDF_FILE = DOCS / "数据安全指南.pdf"

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
<title>Takealot ERP 数据安全指南</title>
<style>
  @page {{ margin: 18mm 16mm 20mm 16mm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #2a3034;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }}
  h1 {{
    font-size: 22pt;
    color: #1a1d26;
    border-bottom: 2px solid #c9a86a;
    padding-bottom: 8px;
    margin: 0 0 12px;
    page-break-after: avoid;
  }}
  h2 {{
    font-size: 14pt;
    color: #343c40;
    margin: 22px 0 10px;
    padding-left: 10px;
    border-left: 4px solid #b98635;
    page-break-after: avoid;
  }}
  h3 {{
    font-size: 11.5pt;
    color: #4a5568;
    margin: 16px 0 8px;
    page-break-after: avoid;
  }}
  p {{ margin: 8px 0; }}
  blockquote {{
    margin: 10px 0;
    padding: 8px 14px;
    background: #faf6ef;
    border-left: 4px solid #c9a86a;
    color: #5c6578;
    font-size: 10pt;
  }}
  hr {{
    border: none;
    border-top: 1px solid #e8dfd3;
    margin: 18px 0;
  }}
  ul, ol {{ margin: 8px 0 8px 20px; padding: 0; }}
  li {{ margin: 4px 0; }}
  code {{
    font-family: Consolas, "Courier New", monospace;
    font-size: 9pt;
    background: #f5f2ec;
    padding: 1px 5px;
    border-radius: 3px;
    color: #8a6330;
  }}
  pre {{
    background: #2a3034;
    color: #e8e4dc;
    padding: 12px 14px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.45;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
  }}
  pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }}
  th {{
    background: #f5f1ea;
    color: #5c4a32;
    font-weight: 600;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid #e3dbd0;
  }}
  td {{
    padding: 7px 10px;
    border: 1px solid #eee8df;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{ background: #fbf9f5; }}
  strong {{ color: #1a1d26; }}
  .cover-meta {{
    color: #7c766e;
    font-size: 10pt;
    margin-bottom: 20px;
  }}
  .footer-note {{
    margin-top: 24px;
    font-size: 9.5pt;
    color: #9a9288;
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
    """Lightweight markdown → HTML (no external deps)."""
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    in_code = False
    in_table = False
    table_rows: list[list[str]] = []

    def flush_table() -> None:
        nonlocal in_table, table_rows
        if not table_rows:
            return
        out.append("<table>")
        for ri, row in enumerate(table_rows):
            tag = "th" if ri == 0 else "td"
            out.append("<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in row) + "</tr>")
        out.append("</table>")
        table_rows = []
        in_table = False

    def inline(text: str) -> str:
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
        return text

    while i < len(lines):
        line = lines[i]

        if line.strip().startswith("```"):
            flush_table()
            if in_code:
                out.append("</code></pre>")
                in_code = False
            else:
                out.append("<pre><code>")
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
            in_table = True
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
        elif re.match(r"^[-*] ", line):
            items = [line]
            i += 1
            while i < len(lines) and re.match(r"^[-*] ", lines[i]):
                items.append(lines[i])
                i += 1
            out.append("<ul>" + "".join(f"<li>{inline(it[2:].strip())}</li>" for it in items) + "</ul>")
            continue
        elif re.match(r"^\d+\. ", line):
            items = [line]
            i += 1
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(lines[i])
                i += 1
            out.append("<ol>" + "".join(f"<li>{inline(re.sub(r'^\d+\.\s*', '', it))}</li>" for it in items) + "</ol>")
            continue
        elif line.strip().startswith("- [ ]"):
            out.append(f"<ul><li>{inline(line.strip()[5:].strip())}</li></ul>")
        elif line.strip() == "":
            pass
        else:
            if line.strip().startswith("*") and line.strip().endswith("*") and not line.strip().startswith("**"):
                out.append(f'<p class="footer-note">{inline(line.strip().strip("*"))}</p>')
            else:
                out.append(f"<p>{inline(line.strip())}</p>")

        i += 1

    flush_table()
    if in_code:
        out.append("</code></pre>")

    html = "\n".join(out)
    html = html.replace("<h1>Takealot ERP 数据安全指南</h1>", '<h1>Takealot ERP 数据安全指南</h1>', 1)
    # Wrap version blockquote after h1
    html = re.sub(
        r"(<h1>Takealot ERP 数据安全指南</h1>\s*)<blockquote><p>(版本：[^<]+)</p></blockquote>",
        r'\1<p class="cover-meta">\2</p>',
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
