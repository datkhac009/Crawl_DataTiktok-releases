@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   BUILD ^& RELEASE Crawl_DataTiktok.exe
echo ============================================

REM Go bien ELECTRON_RUN_AS_NODE (may nay co set san, gay loi electron-builder)
set "ELECTRON_RUN_AS_NODE="
REM Tat kiem tra SSL (may co AV/proxy can thiep HTTPS -> tai cong cu/se loi)
set "NODE_TLS_REJECT_UNAUTHORIZED=0"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

set "RELEASE=..\Crawl_DataTiktok_Release"
set "REPO=Hung13010/Crawl_DataTiktok-releases"

REM ====== 1. Tang version (patch) TRUOC khi build, de .exe mang dung version moi ======
echo.
echo [1/4] Tang version (patch)...
set "VERSION="
for /f "delims=" %%v in ('node version-bump.cjs') do set "VERSION=%%v"
if not defined VERSION (
  echo.
  echo *** TANG VERSION THAT BAI ***
  pause
  exit /b 1
)
echo   Version moi: %VERSION%

REM ====== 2. Build app bang electron-builder (qua pnpm) ======
echo.
echo [2/4] Dang build app (electron-builder)...
call pnpm run build
if errorlevel 1 (
  echo.
  echo *** BUILD THAT BAI ***
  pause
  exit /b 1
)

REM ====== 3. Copy Playwright CHROMIUM + FIREFOX vao ban build ======
REM Chromium: engine crawl chinh. Firefox: BAT BUOC de trich cookie tu profile Firefox
REM Portable import tren MAY KHAC (2026-07-13 — truoc day bo Firefox ra vi tuong chi seed
REM tren may dev, lam moi may khac khong lay duoc trang thai dang nhap: "Executable doesn't
REM exist" am tham -> ket phien khach). Chi copy DUNG revision Firefox app dang can.
echo.
echo [3/4] Copy Chromium + Firefox (Playwright) vao lib\ms-playwright...
set "PW_SRC=%LOCALAPPDATA%\ms-playwright"
REM Lay revision Firefox ma ban playwright hien tai yeu cau (vd 1522).
set "FFREV="
for /f "usebackq delims=" %%r in (`node -e "const b=require('./node_modules/playwright-core/browsers.json').browsers.find(function(x){return x.name==='firefox'}); console.log(b.revision)"`) do set "FFREV=%%r"
REM Don firefox-* cu (khac revision) con sot lai trong ban build truoc; robocopy khong tu xoa.
if exist "%RELEASE%\lib\ms-playwright" (
  for /d %%d in ("%RELEASE%\lib\ms-playwright\firefox-*") do (
    if /i not "%%~nxd"=="firefox-%FFREV%" rd /s /q "%%d"
  )
)
if exist "%PW_SRC%" (
  robocopy "%PW_SRC%" "%RELEASE%\lib\ms-playwright" /E /XD "%PW_SRC%\firefox-*" /NFL /NDL /NJH /NJS /NP >nul
  if defined FFREV (
    if exist "%PW_SRC%\firefox-%FFREV%" (
      robocopy "%PW_SRC%\firefox-%FFREV%" "%RELEASE%\lib\ms-playwright\firefox-%FFREV%" /E /NFL /NDL /NJH /NJS /NP >nul
      echo   Da copy Chromium + Firefox rev %FFREV%.
    ) else (
      echo   [Canh bao] Thieu "%PW_SRC%\firefox-%FFREV%". Chay: pnpm exec playwright install firefox
    )
  ) else (
    echo   [Canh bao] Khong doc duoc revision Firefox tu browsers.json — bo qua Firefox.
  )
) else (
  echo   [Canh bao] Khong thay "%PW_SRC%".
  echo   App se can Playwright Chromium de chay. Chay: pnpm exec playwright install chromium
)

REM ====== 3b. Dam bao firefox-<rev>.zip co tren release tag "browsers" ======
REM App tren may khac neu thieu Firefox se tu tai file zip nay ve (updater.cjs
REM ensureFirefox). Chi nen + upload MOT LAN cho moi revision; cac lan build sau bo qua.
if defined FFREV (
  gh release view browsers -R %REPO% >nul 2>&1
  if errorlevel 1 (
    echo   Tao release tag "browsers" chua asset trinh duyet...
    gh release create browsers -R %REPO% --title "Browser assets" --notes "Firefox cho may thieu - app tu tai khi can. Khong phai ban cap nhat."
  )
  gh release view browsers -R %REPO% --json assets -q ".assets[].name" 2>nul | findstr /i /c:"firefox-%FFREV%.zip" >nul
  if errorlevel 1 (
    echo   Nen firefox-%FFREV% thanh zip - co the mat vai phut...
    powershell -NoProfile -NonInteractive -Command "Compress-Archive -LiteralPath '%PW_SRC%\firefox-%FFREV%' -DestinationPath '%TEMP%\firefox-%FFREV%.zip' -Force"
    if exist "%TEMP%\firefox-%FFREV%.zip" (
      echo   Upload firefox-%FFREV%.zip len release "browsers"...
      gh release upload browsers "%TEMP%\firefox-%FFREV%.zip" -R %REPO% --clobber
      del "%TEMP%\firefox-%FFREV%.zip" >nul 2>&1
    ) else (
      echo   [Canh bao] Nen zip that bai - may khac se KHONG tu tai duoc Firefox.
    )
  ) else (
    echo   firefox-%FFREV%.zip da co tren release "browsers" - bo qua.
  )
)

REM ====== 4. Tao GitHub release, CHI kem .exe, tranh lo cookie/source ======
echo.
echo [4/4] Tao release v%VERSION% len %REPO%...
gh release create v%VERSION% "%RELEASE%\Crawl_DataTiktok.exe" -R %REPO% --title "v%VERSION%" --notes "Ban phat hanh tu dong v%VERSION%"
if errorlevel 1 (
  echo.
  echo *** TAO RELEASE THAT BAI ***
  echo App da build xong o %RELEASE%, chi rieng buoc release bi loi.
  echo Co the do: chua dang nhap gh, mat mang, hoac tag v%VERSION% da ton tai.
  pause
  exit /b 1
)

echo.
echo ----------------------------------------------
echo HOAN TAT! Da phat hanh v%VERSION%
echo File EXE: %RELEASE%\Crawl_DataTiktok.exe
echo Release:  https://github.com/%REPO%/releases/tag/v%VERSION%
echo ----------------------------------------------
pause
