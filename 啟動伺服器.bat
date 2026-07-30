@echo off
cd /d "%~dp0"
echo 啟動中，瀏覽器將自動打開...
echo 若要用手機/平板連線，改用同一個 Wi-Fi 底下這台電腦的區網 IP，例如 http://192.168.x.x:8420
start "" http://localhost:8420
python -m http.server 8420
pause
