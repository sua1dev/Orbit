@echo off
setlocal
chcp 65001 >nul
title Orbit - Cloudflare Deploy
pushd "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
set "DEPLOY_EXIT_CODE=%ERRORLEVEL%"
popd
if "%~1"=="" pause
exit /b %DEPLOY_EXIT_CODE%
