@echo off
chcp 65001 >nul
start "" "%~dp0OMS全流程图.html"
echo.
echo 已打开 OMS 全流程图
echo 导出 Word：python "%~dp0html_to_word.py"
pause
