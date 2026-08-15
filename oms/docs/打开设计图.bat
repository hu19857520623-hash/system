@echo off
chcp 65001 >nul
start "" "%~dp0系统方案设计图.html"
echo 已在默认浏览器中打开设计图 HTML。
echo 若图表空白，请确认电脑已联网（需加载 Mermaid 图表库）。
pause
