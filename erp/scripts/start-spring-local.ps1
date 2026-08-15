# Start Spring Cloud stack locally (registry + gateway + all microservices).
# Requires JDK 21. Uses Maven from .tools or PATH.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$services = Join-Path $root "services"
$mvn = Join-Path $root ".tools\apache-maven-3.9.9\bin\mvn.cmd"

if (-not (Test-Path $mvn)) {
    $mvnCmd = Get-Command mvn -ErrorAction SilentlyContinue
    if ($mvnCmd) { $mvn = $mvnCmd.Source } else { throw "Maven not found. Run from repo root or install Maven 3.9+." }
}

Push-Location $services
try {
    & $mvn -q -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw "Maven build failed" }

    $env:EUREKA_URL = "http://localhost:8761/eureka/"
    $env:LEGACY_BACKEND_URL = "http://localhost:3001"

    $modules = @(
        "erp-registry",
        "erp-auth-service",
        "erp-crm-service",
        "erp-scm-service",
        "erp-finance-service",
        "erp-integration-service",
        "erp-gateway"
    )

    foreach ($mod in $modules) {
        $jar = Get-ChildItem "$mod\target\$mod-*.jar" | Where-Object { $_.Name -notmatch 'original' } | Select-Object -First 1
        if (-not $jar) { throw "JAR not found for $mod" }
        Write-Host "Starting $mod ..."
        Start-Process -FilePath "java" -ArgumentList "-jar", $jar.FullName -WindowStyle Minimized
        Start-Sleep -Seconds 2
    }

    Write-Host ""
    Write-Host "Spring Cloud stack started."
    Write-Host "  Eureka:  http://localhost:8761"
    Write-Host "  Gateway: http://localhost:9000/api/"
    Write-Host "  Auth:    http://localhost:9101/auth/ping"
} finally {
    Pop-Location
}
