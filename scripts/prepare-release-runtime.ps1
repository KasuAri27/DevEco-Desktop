$ErrorActionPreference = 'Stop'

$nodeVersion = '24.15.0'
$agentVersion = '0.2.3'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $repoRoot 'bundled-runtime'
$nodeTarget = Join-Path $runtimeRoot 'node-runtime\node.exe'
$nodeDirectory = Split-Path -Parent $nodeTarget

New-Item -ItemType Directory -Force -Path $nodeDirectory | Out-Null

$bundledNodeVersion = $null
if (Test-Path -LiteralPath $nodeTarget) {
    $bundledNodeVersion = (& $nodeTarget -p 'process.versions.node').Trim()
}

if ($bundledNodeVersion -ne $nodeVersion) {
    $hostNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $hostNodeVersion = $null
    if ($hostNode) {
        $hostNodeVersion = (& $hostNode.Source -p 'process.versions.node').Trim()
    }

    if ($hostNodeVersion -eq $nodeVersion) {
        Copy-Item -LiteralPath $hostNode.Source -Destination $nodeTarget -Force
    } else {
        $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "deveco-agent-desktop-node-$nodeVersion"
        New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

        $archiveName = "node-v$nodeVersion-win-x64.zip"
        $archivePath = Join-Path $temporaryRoot $archiveName
        $releaseUrl = "https://nodejs.org/dist/v$nodeVersion"
        Invoke-WebRequest -Uri "$releaseUrl/$archiveName" -OutFile $archivePath

        $checksums = (Invoke-WebRequest -Uri "$releaseUrl/SHASUMS256.txt").Content
        $checksumLine = $checksums -split "`r?`n" | Where-Object {
            $_ -match "^([0-9a-fA-F]{64})\s+$([regex]::Escape($archiveName))$"
        } | Select-Object -First 1
        if (-not $checksumLine) {
            throw "Could not find the SHA-256 entry for $archiveName."
        }

        $expectedHash = [regex]::Match($checksumLine, '^[0-9a-fA-F]{64}').Value.ToLowerInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "SHA-256 verification failed for $archiveName."
        }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryRoot -Force
        $archiveNode = Join-Path $temporaryRoot "node-v$nodeVersion-win-x64\node.exe"
        if (-not (Test-Path -LiteralPath $archiveNode)) {
            throw "The Node.js archive did not contain node.exe."
        }
        Copy-Item -LiteralPath $archiveNode -Destination $nodeTarget -Force
    }
}

$installedNodeVersion = (& $nodeTarget -p 'process.versions.node').Trim()
if ($installedNodeVersion -ne $nodeVersion) {
    throw "Bundled Node.js must be $nodeVersion; found $installedNodeVersion."
}

$installArguments = @(
    'install',
    '--prefix', $runtimeRoot,
    '--no-save',
    '--no-package-lock',
    '--install-strategy=nested',
    "@deveco/deveco-code@$agentVersion"
)
& npm @installArguments
if ($LASTEXITCODE -ne 0) {
    throw "Installing @deveco/deveco-code@$agentVersion failed (npm exit code $LASTEXITCODE)."
}

$agentRoot = Join-Path $runtimeRoot 'node_modules\@deveco\deveco-code'
$agentManifestPath = Join-Path $agentRoot 'package.json'
$agentBinaryPath = Join-Path $agentRoot 'bin\deveco.exe'
if (-not (Test-Path -LiteralPath $agentManifestPath)) {
    throw 'The DevEco Code Agent package was not installed.'
}
$agentManifest = Get-Content -LiteralPath $agentManifestPath -Raw | ConvertFrom-Json
if ($agentManifest.version -ne $agentVersion) {
    throw "Expected DevEco Code Agent $agentVersion; found $($agentManifest.version)."
}
if (-not (Test-Path -LiteralPath $agentBinaryPath)) {
    throw 'The DevEco Code Agent Windows executable was not installed.'
}

Write-Output "Prepared DevEco Code Agent $agentVersion and Node.js $nodeVersion."
