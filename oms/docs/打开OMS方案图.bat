@echo off
chcp 65001 >nul
start "" "%~dp0OMS系统方案设计图.html"
echo.
echo 已打开 OMS 系统方案设计图（含权限架构页）
echo.
echo 导出 PNG 到桌面：python "%~dp0export_diagram_png.py"
pause
