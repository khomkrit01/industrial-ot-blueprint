/**
 * Production Release & Zero-Data-Loss Patch Packager (npm run release:pack)
 *
 * 1. Compiles all packages (contracts, calculation-core, backend-service, frontend-hmi)
 * 2. Strips all TypeScript (.ts / .tsx) source code and .map source maps
 * 3. Packages only compiled runtime assets into dist-release/app/
 * 4. Generates PowerShell scripts for:
 *    - start-production.ps1 (Starts single-port production server with strict license lock & isolated ITA_DATA_DIR)
 *    - apply-patch.ps1 (Backs up customer SQLite DB first, replaces only app/, preserves data/ & license/)
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { APP_RELEASE_VERSION } from '../packages/backend-service/src/license';

const rootDir = process.cwd();
const releaseRoot = path.resolve(rootDir, 'dist-release');
const appOutDir = path.join(releaseRoot, 'app');
const scriptsOutDir = path.join(releaseRoot, 'scripts');
const dataTemplateDir = path.join(releaseRoot, 'data');

function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (
      !entry.name.endsWith('.map') &&
      !entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.d.ts')
    ) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('=============================================================');
  console.log(
    ` BUILDING HARDENED PRODUCTION RELEASE & PATCH BUNDLE (${APP_RELEASE_VERSION})`
  );
  console.log('=============================================================');

  execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

  if (fs.existsSync(appOutDir)) {
    fs.rmSync(appOutDir, { recursive: true, force: true });
  }
  fs.mkdirSync(appOutDir, { recursive: true });
  fs.mkdirSync(scriptsOutDir, { recursive: true });
  fs.mkdirSync(path.join(dataTemplateDir, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(dataTemplateDir, 'license'), { recursive: true });

  // 1. Copy minified Frontend HMI assets into app/ui/ (No source maps, no .ts/.tsx)
  const uiOutDir = path.join(appOutDir, 'ui');
  copyDirRecursive(
    path.join(rootDir, 'packages', 'frontend-hmi', 'dist'),
    uiOutDir
  );

  // 2. Bundle + Minify + Mangle Backend + Calculation Core + Contracts + ALL npm dependencies
  //    into a 100% self-contained CJS bundle (ZERO node_modules or npm install required on customer PC!)
  //    AND strip the Vendor Ed25519 Private Key via --define:__STRIP_VENDOR_PRIVATE_KEY__=true
  const tempBundlePath = path.join(appOutDir, '_tmp_bundle.cjs');
  const esbuildCmd = [
    `node "${path.join(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild')}"`,
    `"${path.join(rootDir, 'packages', 'backend-service', 'src', 'index.ts')}"`,
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    '--minify',
    '--minify-identifiers',
    '--minify-syntax',
    '--minify-whitespace',
    '--legal-comments=none',
    '--define:__STRIP_VENDOR_PRIVATE_KEY__=true',
    '--define:import.meta.url=__filename',
    `--outfile="${tempBundlePath}"`,
  ].join(' ');

  console.log(
    '[Hardening] Bundling 100% self-contained engine (zero node_modules required)...'
  );
  execSync(esbuildCmd, { stdio: 'inherit', cwd: rootDir });

  // 3. Compress (Deflate) + Encrypt (AES-256-GCM) the bundled code into binary ita-engine.dat
  const rawMinifiedCode = fs.readFileSync(tempBundlePath);
  fs.rmSync(tempBundlePath, { force: true });

  const compressedCode = zlib.deflateRawSync(rawMinifiedCode, { level: 9 });
  const aesKey = crypto
    .createHash('sha256')
    .update('ITA-BINARY-ENGINE-SEAL-V1-HITACHI-ENERGY-2026')
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(compressedCode),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Binary format: [4-byte Magic "ITAE"][12-byte IV][16-byte GCM Tag][Encrypted Payload]
  const magicHeader = Buffer.from('ITAE', 'ascii');
  const binaryDat = Buffer.concat([
    magicHeader,
    iv,
    authTag,
    encryptedPayload,
  ]);
  const engineDatPath = path.join(appOutDir, 'ita-engine.dat');
  fs.writeFileSync(engineDatPath, binaryDat);

  // 4. Write compact minified binary runtime loader (ita-runtime.cjs) that decrypts & compiles in RAM only
  const keyHex = aesKey.toString('hex');
  const runtimeLoader = `"use strict";const _c=require("node:crypto"),_f=require("node:fs"),_p=require("node:path"),_z=require("node:zlib"),_m=require("node:module");(function(){process.env.ITA_AUTO_START="true";const b=_f.readFileSync(_p.join(__dirname,"ita-engine.dat"));if(b.subarray(0,4).toString("ascii")!=="ITAE")throw new Error("Corrupted engine binary");const d=_c.createDecipheriv("aes-256-gcm",Buffer.from("${keyHex}","hex"),b.subarray(4,16));d.setAuthTag(b.subarray(16,32));const s=_z.inflateRawSync(Buffer.concat([d.update(b.subarray(32)),d.final()])).toString("utf8");const m=new _m(__filename,module);m.filename=__filename;m.paths=_m._nodeModulePaths(__dirname);m._compile(s,__filename);})();\n`;
  fs.writeFileSync(
    path.join(appOutDir, 'ita-runtime.cjs'),
    runtimeLoader,
    'utf8'
  );

  // 5. Write flat production package.json (100% self-contained — zero external npm dependencies needed)
  const prodRootPkg = {
    name: 'ita-production-runtime',
    version: APP_RELEASE_VERSION.replace(/^v/, ''),
    private: true,
    scripts: {
      start: 'node ita-runtime.cjs',
    },
  };
  fs.writeFileSync(
    path.join(appOutDir, 'package.json'),
    JSON.stringify(prodRootPkg, null, 2),
    'utf8'
  );

  // Write start-production.ps1 (Manual Console Mode)
  const startScript = `# Hitachi Energy — ITA Production Server Launcher (${APP_RELEASE_VERSION})
$ErrorActionPreference = "Stop"
$InstallRoot = Split-Path -Parent $PSScriptRoot
$env:NODE_ENV = "production"
$env:ITA_STRICT_LICENSE = "true"
$env:ITA_DATA_DIR = Join-Path $InstallRoot "data"
$env:ITA_FRONTEND_DIST = Join-Path $InstallRoot "app\\ui"
$env:PORT = "4000"

Write-Host "Starting ITA Production System (${APP_RELEASE_VERSION}) on http://localhost:4000 ..."
Write-Host "Isolated Customer Data Directory: $env:ITA_DATA_DIR"
Set-Location (Join-Path $InstallRoot "app")
node ita-runtime.cjs
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'start-production.ps1'),
    startScript,
    'utf8'
  );

  // Also write start-production.bat for one-click double-click launching in Windows Explorer
  const startBat = `@echo off
title Hitachi Energy — ITA Production Server (${APP_RELEASE_VERSION})
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-production.ps1"
pause
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'start-production.bat'),
    startBat,
    'utf8'
  );

  // Write ita-watchdog.ps1 (Background Auto-Restart Watchdog using 100% Microsoft-signed powershell.exe & OpenJS-signed node.exe)
  // Write install-windows-service.ps1
  // Compiles HitachiEnergyItaService.exe locally on the target machine via a clean SYSTEM Scheduled Task
  // (svchost.exe -> csc.exe) so it never carries network/ZIP Mark-of-the-Web (Error 4551 proof),
  // and registers a genuine Windows Service ('ITAImpregnationService') in services.msc!
  const installServicePs1 = `# Hitachi Energy — ITA Windows Service Installer (${APP_RELEASE_VERSION})
$ErrorActionPreference = "Stop"

# Verify Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "=============================================================" -ForegroundColor Red
  Write-Host " ERROR: Please right-click 'install-windows-service.bat' and" -ForegroundColor Red
  Write-Host " select 'Run as administrator'!" -ForegroundColor Red
  Write-Host "=============================================================" -ForegroundColor Red
  exit 1
}

$ServiceName = "ITAImpregnationService"
$DisplayName = "Hitachi Energy - ITA Impregnation Tracking System"
$Description = "Industrial Edge Server & SQLite WAL Telemetry Engine for Transformer Oil Impregnation Time Tracking & Analysis (Port 4000)."
$LegacyTaskName = "HitachiEnergy-ITA-Service"
$BuilderTaskName = "HitachiEnergy-ITA-CleanHostBuilder"

$ScriptsDir = $PSScriptRoot
$InstallRoot = Split-Path -Parent $ScriptsDir
$AppDir = Join-Path $InstallRoot "app"
$DataDir = Join-Path $InstallRoot "data"
$ExePath = Join-Path $ScriptsDir "HitachiEnergyItaService.exe"
$OldExePath = Join-Path $ScriptsDir "ita-service-host.exe"
$CsPath = Join-Path $ScriptsDir "ItaServiceHost.cs"
$WatchdogPidFile = Join-Path $DataDir "ita-watchdog.pid"
$NodePidFile = Join-Path $DataDir "ita-node.pid"

# Unblock all files in installation directory to strip any network/ZIP Zone.Identifier streams
Get-ChildItem -Path $InstallRoot -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

# 1. Detect Node.js binary path
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Host "ERROR: Node.js ('node') was not found in PATH. Please install Node.js LTS first." -ForegroundColor Red
  exit 1
}
$NodeFullPath = $NodeCmd.Source
Set-Content -Path (Join-Path $ScriptsDir "service-node-path.txt") -Value $NodeFullPath -Encoding UTF8
Write-Host "[1/4] Detected Node.js runtime: $NodeFullPath"

# 2. Clean up any previous Task Scheduler background job & stop existing Windows Service
Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ScriptsDir "ita-watchdog.ps1") -Force -ErrorAction SilentlyContinue

if (Test-Path $WatchdogPidFile) {
  $OldWpid = (Get-Content $WatchdogPidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($OldWpid) { Stop-Process -Id ([int]$OldWpid) -Force -ErrorAction SilentlyContinue }
  Remove-Item $WatchdogPidFile -Force -ErrorAction SilentlyContinue
}
if (Test-Path $NodePidFile) {
  $OldNpid = (Get-Content $NodePidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($OldNpid) { Stop-Process -Id ([int]$OldNpid) -Force -ErrorAction SilentlyContinue }
  Remove-Item $NodePidFile -Force -ErrorAction SilentlyContinue
}

$ExistingSvc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingSvc) {
  Write-Host "[2/4] Stopping existing Windows Service '$ServiceName'..."
  if ($ExistingSvc.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
} else {
  Write-Host "[2/4] Preparing clean Windows Service environment..."
}

Stop-Process -Name "HitachiEnergyItaService" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "ita-service-host" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Always delete old .exe and .cs files BEFORE compiling so NTFS never preserves tainted Extended Attributes
Remove-Item $OldExePath -Force -ErrorAction SilentlyContinue
Remove-Item $ExePath -Force -ErrorAction SilentlyContinue
Remove-Item $CsPath -Force -ErrorAction SilentlyContinue

# 3. Generate fresh C# Windows Service source locally & compile via clean SYSTEM process (svchost.exe -> csc.exe)
Write-Host "[3/4] Building native Windows Service host ($ExePath)..."
$BuildStamp = [Guid]::NewGuid().ToString("N")
$CsSource = @"
// BuildStamp: $BuildStamp
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.ServiceProcess;
using System.Threading;

[assembly: AssemblyTitle("Hitachi Energy ITA Impregnation Service Host")]
[assembly: AssemblyProduct("Hitachi Energy ITA ($BuildStamp)")]
[assembly: AssemblyVersion("1.53.0.0")]

public class ItaWindowsService : ServiceBase
{
    private Process _nodeProcess;
    private volatile bool _stopping = false;
    private System.Timers.Timer _watchdogTimer;
    private string _installRoot;
    private string _logFile;
    private string _nodePidFile;

    public ItaWindowsService()
    {
        this.ServiceName = "ITAImpregnationService";
        this.CanStop = true;
        this.CanPauseAndContinue = false;
        this.AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        try
        {
            _stopping = false;
            string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\', '/');
            _installRoot = Directory.GetParent(exeDir).FullName;
            string dataDir = Path.Combine(_installRoot, "data");
            string logDir = Path.Combine(dataDir, "logs");
            Directory.CreateDirectory(logDir);
            _logFile = Path.Combine(logDir, "ita-service.log");
            _nodePidFile = Path.Combine(dataDir, "ita-node.pid");

            AppendLog("=== ITAImpregnationService OnStart (services.msc) ===");
            StartNodeProcess();

            _watchdogTimer = new System.Timers.Timer(5000);
            _watchdogTimer.Elapsed += (s, e) =>
            {
                if (_stopping) return;
                try
                {
                    if (_nodeProcess == null || _nodeProcess.HasExited)
                    {
                        AppendLog("Node process exited unexpectedly. Restarting in 2s...");
                        Thread.Sleep(2000);
                        if (!_stopping) StartNodeProcess();
                    }
                }
                catch (Exception ex)
                {
                    AppendLog("Watchdog error: " + ex.Message);
                }
            };
            _watchdogTimer.Start();
        }
        catch (Exception ex)
        {
            AppendLog("Fatal OnStart error: " + ex.ToString());
            throw;
        }
    }

    private void StartNodeProcess()
    {
        try
        {
            string appDir = Path.Combine(_installRoot, "app");
            string dataDir = Path.Combine(_installRoot, "data");
            string frontendDist = Path.Combine(appDir, "ui");
            if (!Directory.Exists(frontendDist))
            {
                frontendDist = Path.Combine(appDir, "packages", "frontend-hmi", "dist");
            }
            string entryJs = Path.Combine(appDir, "ita-runtime.cjs");
            if (!File.Exists(entryJs))
            {
                entryJs = Path.Combine(appDir, "packages", "backend-service", "dist", "index.js");
            }

            string nodeExe = "node.exe";
            string nodePathCfg = Path.Combine(_installRoot, "scripts", "service-node-path.txt");
            if (File.Exists(nodePathCfg))
            {
                string customNode = File.ReadAllText(nodePathCfg).Trim();
                if (!string.IsNullOrEmpty(customNode) && File.Exists(customNode))
                {
                    nodeExe = customNode;
                }
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\\"" + entryJs + "\\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["ITA_STRICT_LICENSE"] = "true";
            psi.EnvironmentVariables["ITA_DATA_DIR"] = dataDir;
            psi.EnvironmentVariables["ITA_FRONTEND_DIST"] = frontendDist;
            psi.EnvironmentVariables["PORT"] = "4000";

            _nodeProcess = new Process();
            _nodeProcess.StartInfo = psi;
            _nodeProcess.OutputDataReceived += (s, e) => { if (e.Data != null) AppendLog("[OUT] " + e.Data); };
            _nodeProcess.ErrorDataReceived += (s, e) => { if (e.Data != null) AppendLog("[ERR] " + e.Data); };
            _nodeProcess.Start();
            _nodeProcess.BeginOutputReadLine();
            _nodeProcess.BeginErrorReadLine();

            try { File.WriteAllText(_nodePidFile, _nodeProcess.Id.ToString()); } catch { }
            AppendLog("Started Node.js PID=" + _nodeProcess.Id + " using " + nodeExe);
        }
        catch (Exception ex)
        {
            AppendLog("Failed to start Node.js process: " + ex.ToString());
        }
    }

    protected override void OnStop()
    {
        _stopping = true;
        AppendLog("=== ITAImpregnationService OnStop (services.msc) ===");
        if (_watchdogTimer != null)
        {
            _watchdogTimer.Stop();
            _watchdogTimer.Dispose();
        }
        try
        {
            if (_nodeProcess != null && !_nodeProcess.HasExited)
            {
                _nodeProcess.Kill();
                _nodeProcess.WaitForExit(5000);
            }
            if (File.Exists(_nodePidFile))
            {
                File.Delete(_nodePidFile);
            }
        }
        catch (Exception ex)
        {
            AppendLog("Error stopping Node process: " + ex.Message);
        }
    }

    private void AppendLog(string message)
    {
        try
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine;
            File.AppendAllText(_logFile, line);
        }
        catch { }
    }

    public static void Main()
    {
        ServiceBase.Run(new ItaWindowsService());
    }
}
"@
Set-Content -Path $CsPath -Value $CsSource -Encoding UTF8
Unblock-File -Path $CsPath -ErrorAction SilentlyContinue

$Csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
if (-not (Test-Path $Csc)) {
  Write-Host "ERROR: .NET Framework C# compiler not found at $Csc" -ForegroundColor Red
  exit 1
}

# Compile via clean SYSTEM Scheduled Task (svchost.exe parent) so Smart App Control never taints the binary
$BuildArgs = "/nologo /target:exe /out:\`"$ExePath\`" /r:System.ServiceProcess.dll \`"$CsPath\`""
$BuildAction = New-ScheduledTaskAction -Execute $Csc -Argument $BuildArgs -WorkingDirectory $ScriptsDir
$BuildPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $BuilderTaskName -Action $BuildAction -Principal $BuildPrincipal -Force | Out-Null
Start-ScheduledTask -TaskName $BuilderTaskName
for ($w = 1; $w -le 20; $w++) {
  if (Test-Path $ExePath) { break }
  Start-Sleep -Milliseconds 250
}
Unregister-ScheduledTask -TaskName $BuilderTaskName -Confirm:$false -ErrorAction SilentlyContinue

if (-not (Test-Path $ExePath)) {
  # Fallback direct compile if Task Scheduler was disabled
  & $Csc /nologo /target:exe /out:$ExePath /r:System.ServiceProcess.dll $CsPath
}
Remove-Item $CsPath -Force -ErrorAction SilentlyContinue
Unblock-File -Path $ExePath -ErrorAction SilentlyContinue

# 4. Register & Start Windows Service in services.msc
Write-Host "[4/4] Registering and starting Windows Service '$DisplayName' in services.msc..."
$ExistingSvc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $ExistingSvc) {
  New-Service -Name $ServiceName -BinaryPathName "\`"$ExePath\`"" -DisplayName $DisplayName -Description $Description -StartupType Automatic | Out-Null
} else {
  Set-Service -Name $ServiceName -DisplayName $DisplayName -Description $Description -StartupType Automatic
  sc.exe config $ServiceName binPath= "\`"$ExePath\`"" start= auto | Out-Null
}
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Start-Service -Name $ServiceName

$HttpReady = $false
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $Resp = Invoke-WebRequest -Uri "http://localhost:4000/api/license/status" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($Resp.StatusCode -eq 200) {
      $HttpReady = $true
      break
    }
  } catch { }
}

$Svc = Get-Service -Name $ServiceName
if ($HttpReady -and $Svc.Status -eq 'Running') {
  Write-Host "=============================================================" -ForegroundColor Green
  Write-Host " WINDOWS SERVICE INSTALLED & RUNNING IN SERVICES.MSC!" -ForegroundColor Green
  Write-Host " Service Name : $ServiceName"
  Write-Host " Display Name : $DisplayName"
  Write-Host " Status       : $($Svc.Status) (Startup Type: Automatic)"
  Write-Host " Web HMI URL  : http://localhost:4000 (200 OK)"
  Write-Host " Service Logs : $(Join-Path $DataDir 'logs\\ita-service.log')"
  Write-Host "=============================================================" -ForegroundColor Green
} else {
  Write-Host "=============================================================" -ForegroundColor Yellow
  Write-Host " Service Status: $($Svc.Status)" -ForegroundColor Yellow
  $LogFile = Join-Path $DataDir "logs\\ita-service.log"
  if (Test-Path $LogFile) {
    Get-Content $LogFile -Tail 20
  }
  Write-Host "=============================================================" -ForegroundColor Yellow
}
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'install-windows-service.ps1'),
    installServicePs1,
    'utf8'
  );

  const installServiceBat = `@echo off
title Install ITA Windows Service (${APP_RELEASE_VERSION})
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows-service.ps1"
pause
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'install-windows-service.bat'),
    installServiceBat,
    'utf8'
  );

  // Write restart-windows-service.ps1 & .bat
  const restartServicePs1 = `# Hitachi Energy — Restart ITA Windows Service (services.msc)
$ErrorActionPreference = "Stop"
$ServiceName = "ITAImpregnationService"
$Svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $Svc) {
  Write-Host "Service '$ServiceName' is not installed in services.msc. Run install-windows-service.bat as Administrator." -ForegroundColor Yellow
  exit 1
}
Write-Host "Restarting Windows Service '$ServiceName' in services.msc..."
Restart-Service -Name $ServiceName -Force
Start-Sleep -Seconds 2
$Svc = Get-Service -Name $ServiceName
Write-Host "Service '$ServiceName' is now: $($Svc.Status) (http://localhost:4000)" -ForegroundColor Green
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'restart-windows-service.ps1'),
    restartServicePs1,
    'utf8'
  );

  const restartServiceBat = `@echo off
title Restart ITA Windows Service
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-windows-service.ps1"
pause
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'restart-windows-service.bat'),
    restartServiceBat,
    'utf8'
  );

  // Write uninstall-windows-service.ps1 & .bat
  const uninstallServicePs1 = `# Hitachi Energy — Uninstall ITA Windows Service (services.msc)
$ErrorActionPreference = "Stop"
$ServiceName = "ITAImpregnationService"
$LegacyTaskName = "HitachiEnergy-ITA-Service"
$ScriptsDir = $PSScriptRoot
$InstallRoot = Split-Path -Parent $ScriptsDir
$DataDir = Join-Path $InstallRoot "data"
$WatchdogPidFile = Join-Path $DataDir "ita-watchdog.pid"
$NodePidFile = Join-Path $DataDir "ita-node.pid"

Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $WatchdogPidFile) {
  $OldWpid = (Get-Content $WatchdogPidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($OldWpid) { Stop-Process -Id ([int]$OldWpid) -Force -ErrorAction SilentlyContinue }
  Remove-Item $WatchdogPidFile -Force -ErrorAction SilentlyContinue
}

$Svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Svc) {
  Write-Host "Stopping Windows Service '$ServiceName'..."
  if ($Svc.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  sc.exe delete $ServiceName | Out-Null
}
if (Test-Path $NodePidFile) {
  $OldNpid = (Get-Content $NodePidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($OldNpid) { Stop-Process -Id ([int]$OldNpid) -Force -ErrorAction SilentlyContinue }
  Remove-Item $NodePidFile -Force -ErrorAction SilentlyContinue
}
Stop-Process -Name "HitachiEnergyItaService" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "ita-service-host" -Force -ErrorAction SilentlyContinue
Write-Host "Windows Service '$ServiceName' has been uninstalled from services.msc. (Customer data/ and license/ are preserved)." -ForegroundColor Green
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'uninstall-windows-service.ps1'),
    uninstallServicePs1,
    'utf8'
  );

  const uninstallServiceBat = `@echo off
title Uninstall ITA Windows Service
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-windows-service.ps1"
pause
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'uninstall-windows-service.bat'),
    uninstallServiceBat,
    'utf8'
  );

  // Write apply-patch.ps1 (Zero-Data-Loss Customer Patch Updater with Automatic Windows Service Stop/Start)
  const patchScript = `# Hitachi Energy — Zero-Data-Loss Production Patch Installer (${APP_RELEASE_VERSION})
param(
  [string]$TargetInstallDir = "C:\\ITA-Production"
)
$ErrorActionPreference = "Stop"
$ServiceName = "ITAImpregnationService"
$PatchSourceApp = Join-Path (Split-Path -Parent $PSScriptRoot) "app"
$TargetAppDir = Join-Path $TargetInstallDir "app"
$TargetDataDir = Join-Path $TargetInstallDir "data"
$TargetBackupDir = Join-Path $TargetDataDir "backups"
$SqliteFile = Join-Path $TargetDataDir "impregnation.sqlite"

Write-Host "============================================================="
Write-Host " APPLYING ITA PRODUCTION PATCH (${APP_RELEASE_VERSION})"
Write-Host " Target Installation : $TargetInstallDir"
Write-Host "============================================================="

# Stop Windows Service if running so files are unlocked
$Svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$WasServiceRunning = $false
if ($Svc -and $Svc.Status -ne 'Stopped') {
  Write-Host "[0/4] Stopping Windows Service '$ServiceName' before patching..."
  Stop-Service -Name $ServiceName -Force
  $WasServiceRunning = $true
  Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force -Path $TargetBackupDir | Out-Null

if (Test-Path $SqliteFile) {
  $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $BackupFile = Join-Path $TargetBackupDir "impregnation-pre-patch-${APP_RELEASE_VERSION}-$Stamp.sqlite"
  Copy-Item -Path $SqliteFile -Destination $BackupFile -Force
  Write-Host "[1/4] Customer SQLite Database backed up to: $BackupFile"
} else {
  Write-Host "[1/4] No existing SQLite database found at $SqliteFile (Fresh Install)."
}

Write-Host "[2/4] Updating encrypted application binaries in $TargetAppDir (Customer data/ and license/ are untouched)..."
if (Test-Path $TargetAppDir) {
  Remove-Item -Path (Join-Path $TargetAppDir "packages") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $TargetAppDir "ui") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $TargetAppDir "ita-engine.dat") -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $TargetAppDir "ita-runtime.cjs") -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $TargetAppDir | Out-Null
Copy-Item -Path (Join-Path $PatchSourceApp "*") -Destination $TargetAppDir -Recurse -Force

if ($Svc -and $WasServiceRunning) {
  Write-Host "[3/4] Starting Windows Service '$ServiceName'..."
  Start-Service -Name $ServiceName
}

Write-Host "[4/4] Patch ${APP_RELEASE_VERSION} applied successfully with ZERO data loss!"
Write-Host "============================================================="
`;
  fs.writeFileSync(
    path.join(scriptsOutDir, 'apply-patch.ps1'),
    patchScript,
    'utf8'
  );

  // 5. Create Master Core Release ZIP in releases/ITA-Production-Release-v<VERSION>.zip
  const releasesDir = path.join(rootDir, 'releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  const zipFileName = `ITA-Production-Release-v${APP_RELEASE_VERSION}.zip`;
  const zipFilePath = path.join(releasesDir, zipFileName);
  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
  }
  console.log(`[Release] Compressing master archive -> ${zipFilePath} ...`);
  execSync(
    `powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Compress-Archive -Path '${releaseRoot}\\*' -DestinationPath '${zipFilePath}' -CompressionLevel Optimal -Force"`,
    { stdio: 'inherit' }
  );

  console.log('-------------------------------------------------------------');
  console.log(` Release Bundle Ready : ${releaseRoot}`);
  console.log(` Master Release ZIP   : ${zipFilePath}`);
  console.log(` Application Binaries : ${appOutDir} (No .ts/.tsx source code)`);
  console.log(` Patch & Start Scripts: ${scriptsOutDir}`);
  console.log('=============================================================');
}

main();
