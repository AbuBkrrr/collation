# Run in PowerShell AS ADMINISTRATOR. Put my-collation-center-system.zip in your Downloads folder first.
$ErrorActionPreference='Stop'
$Zip="$HOME\Downloads\my-collation-center-system.zip"; $Dir="$HOME\collation"
if(-not(Test-Path $Zip)){throw "Put my-collation-center-system.zip in $HOME\Downloads first."}
if(-not(Get-Command docker -ErrorAction SilentlyContinue)){
  try{wsl --install --no-distribution}catch{}
  winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
  Write-Host "`nDocker Desktop installed. RESTART Windows, open Docker Desktop once (accept the terms), then run this script again." -ForegroundColor Yellow; return }
docker info 2>$null | Out-Null
if($LASTEXITCODE -ne 0){ Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"; Write-Host 'Starting Docker Desktop...'
  do{Start-Sleep 5; docker info 2>$null | Out-Null}until($LASTEXITCODE -eq 0) }
Expand-Archive $Zip $HOME -Force; Set-Location $Dir
$ip=(Get-NetIPConfiguration | Where-Object{$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} | Select-Object -First 1).IPv4Address.IPAddress
function R($n){-join(((48..57)+(65..90)+(97..122))|Get-Random -Count $n|ForEach-Object{[char]$_})}
$cmd=R 12
@"
DOMAIN=$ip
PUBLIC_IP=$ip
CADDY_TLS=tls internal
DB_PASSWORD=$(R 24)
JWT_SECRET=$(R 48)
TURN_SECRET=$(R 32)
LK_KEY=API$(R 10)
LK_SECRET=$(R 40)
COMPOSE_PROFILES=restream
APP_NAME=My Collation Center
COMMAND_PASSCODE=$cmd
PARTIES=APC,PDP,NNPP,ADC,NDC,LP,SDP,APGA,YPP,AA
STT_URL=
"@ | Set-Content .env -Encoding ascii
New-NetFirewallRule -DisplayName 'Collation TCP' -Direction Inbound -Protocol TCP -LocalPort 80,443,7881 -Action Allow -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName 'Collation UDP' -Direction Inbound -Protocol UDP -LocalPort 7882 -Action Allow -ErrorAction SilentlyContinue | Out-Null
docker compose up -d --build
# trust Caddy's local certificate on this PC (phones: install caddy-root.crt too)
foreach($i in 1..12){ Start-Sleep 5; try{ docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$Dir\caddy-root.crt" 2>$null; if(Test-Path "$Dir\caddy-root.crt"){break} }catch{} }
if(Test-Path "$Dir\caddy-root.crt"){ Import-Certificate -FilePath "$Dir\caddy-root.crt" -CertStoreLocation Cert:\LocalMachine\Root | Out-Null }
Write-Host "`nCommand Center : https://$ip/command/`nSituation Room : https://$ip/room/`nObserver app   : https://$ip/observer/`nCommand passcode: $cmd`n(Phones on the same Wi-Fi: open the observer URL; install $Dir\caddy-root.crt on the phone first.)" -ForegroundColor Green
Start-Process "https://$ip/command/"
