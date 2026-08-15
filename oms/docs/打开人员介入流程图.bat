@echo off
chcp 65001 >nul
start "" "%~dp0客户流程与人员介入图.html"
echo 已在默认浏览器中打开「客户流程与人员介入图」。
echo 若图表空白，请确认电脑已联网（需加载 Mermaid 图表库）。
echo 或运行项目根目录：npm run docs  后访问 http://127.0.0.1:8080/客户流程与人员介入图.html
pause
