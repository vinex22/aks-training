#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$Context = 'aks-training-flat'
$Namespace = 'hpa-flat'
$Manifest = Join-Path $PSScriptRoot '../../labs/hpa-flat/console.yaml'

function Invoke-LabKubectl {
    param([string[]] $Arguments)
    & kubectl --context $Context --namespace $Namespace @Arguments
    if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

Write-Host '[1/5] Checking the flat-cluster HPA baseline and existing console.'
Invoke-LabKubectl -Arguments @('get', 'deployment/php-apache', 'hpa/php-apache', '--request-timeout=30s')
$Existing = Invoke-LabKubectl -Arguments @('get', 'deployment/hpa-console', '--ignore-not-found', '-o', 'name', '--request-timeout=30s')

Write-Host '[2/5] Running console tests and validating the Kubernetes manifest.'
$NpmCommand = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
& $NpmCommand --prefix $PSScriptRoot test
if ($LASTEXITCODE -ne 0) { throw 'Console tests failed. Run npm ci in apps/hpa-console if dependencies are missing.' }
Invoke-LabKubectl -Arguments @('apply', '--dry-run=server', '-f', $Manifest, '--request-timeout=30s')

$Maps = @(
    @{
        Name = 'hpa-console-code'
        Files = @(
            "server.mjs=$(Join-Path $PSScriptRoot 'server.mjs')"
            "cluster.mjs=$(Join-Path $PSScriptRoot 'cluster.mjs')"
        )
    }
    @{
        Name = 'hpa-console-ui'
        Files = @(
            "index.html=$(Join-Path $PSScriptRoot 'public/index.html')"
            "app.js=$(Join-Path $PSScriptRoot 'public/app.js')"
            "style.css=$(Join-Path $PSScriptRoot 'public/style.css')"
        )
    }
    @{
        Name = 'hpa-console-icons'
        Files = @(
            "lucide.min.js=$(Join-Path $PSScriptRoot 'node_modules/lucide/dist/umd/lucide.min.js')"
            "LICENSE=$(Join-Path $PSScriptRoot 'node_modules/lucide/LICENSE')"
        )
    }
)

Write-Host '[3/5] Publishing application and browser assets as ConfigMaps.'
foreach ($Map in $Maps) {
    Write-Host "Updating $($Map.Name)"
    $Arguments = @('create', 'configmap', $Map.Name, '--dry-run=client', '-o', 'json')
    $Arguments += $Map.Files | ForEach-Object { "--from-file=$_" }
    $Resource = Invoke-LabKubectl -Arguments $Arguments
    $Resource | & kubectl --context $Context --namespace $Namespace apply --server-side --field-manager=hpa-console-deploy -f -
    if ($LASTEXITCODE -ne 0) { throw "ConfigMap apply failed: $($Map.Name)" }
}

Write-Host '[4/5] Applying console-only resources.'
Invoke-LabKubectl -Arguments @('apply', '-f', $Manifest, '--request-timeout=30s')
if ($Existing) {
    Invoke-LabKubectl -Arguments @('rollout', 'restart', 'deployment/hpa-console', '--request-timeout=30s')
}
Invoke-LabKubectl -Arguments @('rollout', 'status', 'deployment/hpa-console', '--timeout=180s')

Write-Host '[5/5] Console ready. Open a localhost-only Service tunnel:'
Write-Host 'kubectl --context aks-training-flat -n hpa-flat port-forward service/hpa-console 18082:80 --address 127.0.0.1'
Write-Host 'Then open http://127.0.0.1:18082'