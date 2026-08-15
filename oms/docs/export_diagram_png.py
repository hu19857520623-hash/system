# -*- coding: utf-8 -*-
"""将 OMS 方案设计图 HTML 导出为 PNG，保存到桌面。"""
import subprocess
import sys
from pathlib import Path

HTML = Path(__file__).parent / 'OMS系统方案设计图.html'
OUT = Path.home() / 'Desktop' / 'OMS系统方案设计图.png'
FILE_URL = HTML.resolve().as_uri()

EDGE_PATHS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def find_browser():
    for p in EDGE_PATHS:
        if Path(p).exists():
            return p
    return None


def screenshot_playwright() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'playwright', '-q'])
        subprocess.check_call([sys.executable, '-m', 'playwright', 'install', 'chromium'])
        from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1400, 'height': 2400})
        page.goto(FILE_URL, wait_until='networkidle')
        page.screenshot(path=str(OUT), full_page=True, type='png')
        browser.close()
    return OUT.exists() and OUT.stat().st_size > 20000


def main():
    if not HTML.exists():
        print(f'HTML not found: {HTML}')
        sys.exit(1)

    print(f'Exporting: {HTML}')
    ok = False
    try:
        ok = screenshot_playwright()
    except Exception as e:
        print(f'playwright error: {e}')

    if ok:
        print(f'PNG saved: {OUT} ({OUT.stat().st_size // 1024} KB)')
    else:
        print('请双击打开 HTML 文件后手动截图：')
        print(HTML)
        sys.exit(1)


if __name__ == '__main__':
    main()
