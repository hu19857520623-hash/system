"""从旧系统产品 Excel 中提取内嵌图片，并按 SKU 命名。"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET


SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\产品＋图片.xls")
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else r"D:\all\.codex-tmp\legacy-erp-import\product-images")

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.itertext()) for node in root.findall("s:si", NS)]


def sku_by_row(archive: zipfile.ZipFile) -> dict[int, str]:
    strings = shared_strings(archive)
    root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    result: dict[int, str] = {}
    for cell in root.findall(".//s:c", NS):
        address = cell.get("r", "")
        match = re.fullmatch(r"B(\d+)", address)
        if not match:
            continue
        value_node = cell.find("s:v", NS)
        inline_node = cell.find("s:is", NS)
        if value_node is not None and value_node.text is not None:
            value = strings[int(value_node.text)] if cell.get("t") == "s" else value_node.text
        elif inline_node is not None:
            value = "".join(inline_node.itertext())
        else:
            continue
        value = value.strip()
        if value and value != "产品SKU":
            result[int(match.group(1))] = value
    return result


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", value).strip("._") or "unknown"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE) as archive:
        sku_rows = sku_by_row(archive)
        rel_root = ET.fromstring(archive.read("xl/drawings/_rels/drawing1.xml.rels"))
        targets = {
            node.get("Id", ""): str(PurePosixPath("xl/drawings") / node.get("Target", ""))
            for node in rel_root.findall("pr:Relationship", NS)
        }
        targets = {key: str(PurePosixPath(value)) for key, value in targets.items()}
        drawing = ET.fromstring(archive.read("xl/drawings/drawing1.xml"))
        manifest = []
        skipped_placeholders = 0
        for anchor in list(drawing):
            row_node = anchor.find("xdr:from/xdr:row", NS)
            col_node = anchor.find("xdr:from/xdr:col", NS)
            blip = anchor.find(".//a:blip", NS)
            if row_node is None or col_node is None or blip is None or int(col_node.text or "-1") != 0:
                continue
            excel_row = int(row_node.text or "0") + 1
            sku = sku_rows.get(excel_row)
            relation_id = blip.get(f"{{{NS['r']}}}embed", "")
            target = targets.get(relation_id, "").replace("xl/drawings/../", "xl/")
            if not sku or not target or target not in archive.namelist():
                continue
            source_name = PurePosixPath(target).name
            if source_name.lower().startswith("noimg"):
                skipped_placeholders += 1
                continue
            extension = Path(source_name).suffix.lower() or ".jpg"
            destination = OUTPUT / f"{safe_name(sku)}{extension}"
            destination.write_bytes(archive.read(target))
            manifest.append({
                "sku": sku,
                "file": str(destination),
                "objectKey": f"erp/product-images/{destination.name}",
                "sourceMedia": source_name,
            })

    manifest_path = OUTPUT.parent / "product-images-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "source": str(SOURCE),
        "output": str(OUTPUT),
        "extracted": len(manifest),
        "skippedPlaceholders": skipped_placeholders,
        "manifest": str(manifest_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
