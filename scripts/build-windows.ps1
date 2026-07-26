$ErrorActionPreference = 'Stop'
function Step($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
Step 'Validando Node.js'
$version=[version]((node -v).TrimStart('v'))
if($version -lt [version]'20.19.0'){ throw 'Node.js 20.19 ou superior é obrigatório.' }
Step 'Instalando dependências'
npm install --no-audit --no-fund
if($LASTEXITCODE -ne 0){ throw "Falha ao instalar dependências (código $LASTEXITCODE)." }
Step 'Executando validações'
npm run check
if($LASTEXITCODE -ne 0){ throw "Validação falhou (código $LASTEXITCODE)." }
Step 'Gerando Setup e Portable'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run dist:win
if($LASTEXITCODE -ne 0){ throw "Build falhou (código $LASTEXITCODE)." }
Get-ChildItem release -File | Where-Object Extension -eq '.exe' | ForEach-Object { $h=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); "$h  $($_.Name)" | Set-Content "$($_.FullName).sha256" -Encoding utf8 }
Write-Host "`nConcluído. Arquivos em $PWD\release" -ForegroundColor Green
