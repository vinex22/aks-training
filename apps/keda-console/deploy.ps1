#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$Lab = Join-Path $PSScriptRoot '../../labs/keda'
function Invoke-KedaKubectl {
    param([string[]] $Arguments)
    & kubectl --context aks-training-flat --namespace keda-lab @Arguments
    if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}
Write-Host '[1/4] Running tests and checking the target cluster.'
$NpmCommand = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
& $NpmCommand --prefix $PSScriptRoot test
if ($LASTEXITCODE -ne 0) { throw 'KEDA console tests failed.' }
Invoke-KedaKubectl -Arguments @('get', 'nodes', '--request-timeout=30s')
Invoke-KedaKubectl -Arguments @('apply', '-f', (Join-Path $Lab 'namespace.yaml'))
$Existing = Invoke-KedaKubectl -Arguments @('get', 'deployment/keda-console', '--ignore-not-found', '-o', 'name')
$Files = @('config.yaml','service-account.yaml','processor.yaml','trigger-authentication.yaml','scaled-object.yaml','console.yaml')
$Apply = @('apply')
foreach ($File in $Files) { $Apply += @('-f', (Join-Path $Lab $File)) }
Invoke-KedaKubectl -Arguments ($Apply + @('--dry-run=server'))

Write-Host '[2/4] Publishing reviewed source and lockfile ConfigMaps.'
$Code = @('server.mjs','cluster.mjs','kube-api.mjs','azure.mjs','batches.mjs','processor.mjs','package.json','package-lock.json')
$Maps = @(
    @{ Name='keda-console-code'; Files=@($Code | ForEach-Object { "$_=$(Join-Path $PSScriptRoot $_)" }) }
    @{ Name='keda-console-ui'; Files=@('index.html','app.js','style.css') | ForEach-Object { "$_=$(Join-Path $PSScriptRoot "public/$_")" } }
)
foreach ($Map in $Maps) {
    Write-Host "Updating $($Map.Name)"
    $Arguments = @('create','configmap',$Map.Name,'--dry-run=client','-o','json')
    $Arguments += $Map.Files | ForEach-Object { "--from-file=$_" }
    $Resource = Invoke-KedaKubectl -Arguments $Arguments
    $Resource | kubectl --context aks-training-flat -n keda-lab apply --server-side --field-manager=keda-console-deploy -f -
    if ($LASTEXITCODE -ne 0) { throw 'ConfigMap publication failed.' }
}

Write-Host '[3/4] Deploying console, processor, and scaler. No generator Job is started.'
Invoke-KedaKubectl -Arguments $Apply
if ($Existing) {
    Invoke-KedaKubectl -Arguments @('rollout','restart','deployment/keda-console','deployment/azure-queue-processor')
}
Invoke-KedaKubectl -Arguments @('rollout','status','deployment/keda-console','--timeout=300s')
Invoke-KedaKubectl -Arguments @('wait','scaledobject/azure-queue-scaler','--for=condition=Ready','--timeout=180s')
Write-Host '[4/4] Inspecting deployed state.'
Invoke-KedaKubectl -Arguments @('get','deployments,pods,scaledobjects,hpa')
Write-Host 'Access: kubectl --context aks-training-flat -n keda-lab port-forward service/keda-console 18084:80 --address 127.0.0.1'