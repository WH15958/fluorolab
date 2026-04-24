@echo off
chcp 65001 >nul
echo ==========================================
echo   FluoroLab - 一键推送到 GitHub
echo ==========================================
echo.

cd /d "%~dp0"
echo [1/3] 检查 Git 状态...
git status --short
echo.

echo [2/3] 提交代码...
git add .
git commit -m "feat: initial FluoroLab - fluorescence data analysis platform"
echo.

echo [3/3] 推送到 GitHub...
git push -u origin main
echo.

echo ==========================================
echo   推送完成！
echo   稍等 1-2 分钟后访问：
echo   https://WH15958.github.io/fluorolab/
echo ==========================================
pause
