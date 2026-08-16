@echo off
echo Starting Zerodha Clone Trading Platform...
echo [1/3] Starting Backend API (Port 3002)...
start "Zerodha - Backend (3002)" cmd /k "cd /d %~dp0backend && node index.js"

echo [2/3] Starting Kite Dashboard (Port 3001)...
start "Zerodha - Dashboard (3001)" cmd /k "cd /d %~dp0dashboard && npm start"

echo [3/3] Starting Landing Frontend (Port 3000)...
start "Zerodha - Frontend (3000)" cmd /k "cd /d %~dp0frontend && npm start"

echo All services launched!
echo - Landing Page: http://localhost:3000
echo - Dashboard:    http://localhost:3001
echo - Backend API:  http://localhost:3002
