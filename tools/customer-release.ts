/**
 * Customer Site Registry & Pre-Activated Release Packager (`tools/customer-release.ts`)
 *
 * Manages per-customer site deployments without forking the core codebase:
 *   1. Maintains `customers/sites-registry.json` and `customers/CUSTOMER_DEPLOYMENT_REGISTRY.md`
 *   2. Generates an Ed25519 hardware-locked `license.lic` bound to the customer site's `machineId`
 *   3. Embeds `data/license/license.lic` + `SITE_DEPLOYMENT_INFO.txt` into the compiled `dist-release`
 *   4. Compresses a ready-to-deploy customer ZIP archive:
 *        `releases/customers/ITA-v<VERSION>-<SITE_CODE>.zip`
 *
 * Usage Examples:
 *   npm run release:customer -- --list
 *   npm run release:customer -- --all
 *   npm run release:customer -- --site="HITACHI-PLANT-01"
 *   npm run release:customer -- --site="HITACHI-PLANT-02" --customer="Hitachi Energy Rayong" --machine="ITA-1122-3344-5566-7788" --type="PERPETUAL" --tanks=4
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  APP_RELEASE_VERSION,
  encodeLicenseToken,
  issueSignedLicense,
} from '../packages/backend-service/src/license';
import { LicenseType } from '../packages/contracts/src';

export interface CustomerSiteRecord {
  siteCode: string;
  customerName: string;
  plantLocation: string;
  machineId: string;
  licenseType: LicenseType;
  validityDays: number;
  edition: 'STANDARD' | 'ENTERPRISE';
  maxTanks: number;
  deployedVersion: string;
  installPath: string;
  lastPackagedAt: string;
  notes: string;
}

export interface CustomerSitesRegistry {
  schemaVersion: string;
  updatedAt: string;
  sites: CustomerSiteRecord[];
}

function parseArg(flag: string, fallback = ''): string {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length).replace(/^["']|["']$/g, '');
  }
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function loadRegistry(rootDir: string): CustomerSitesRegistry {
  const regPath = path.join(rootDir, 'customers', 'sites-registry.json');
  if (!fs.existsSync(regPath)) {
    return {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      sites: [],
    };
  }
  return JSON.parse(fs.readFileSync(regPath, 'utf8')) as CustomerSitesRegistry;
}

export function saveRegistry(rootDir: string, registry: CustomerSitesRegistry) {
  const customersDir = path.join(rootDir, 'customers');
  fs.mkdirSync(customersDir, { recursive: true });
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(customersDir, 'sites-registry.json'),
    JSON.stringify(registry, null, 2),
    'utf8'
  );

  // Also generate human-readable Markdown table CUSTOMER_DEPLOYMENT_REGISTRY.md
  const rows = registry.sites
    .map(
      (s, idx) =>
        `| ${idx + 1} | **\`${s.siteCode}\`** | ${s.customerName} | \`${s.machineId}\` | \`${s.licenseType}\` (${s.edition}, ${s.maxTanks} Tanks) | \`v${s.deployedVersion}\` | \`ITA-v${s.deployedVersion}-${s.siteCode}.zip\` | ${s.lastPackagedAt.slice(0, 10)} |`
    )
    .join('\n');

  const md = `# Customer Site Deployment & Release Registry
**Current Core Engine Version:** \`v${APP_RELEASE_VERSION}\`  
**Last Updated:** \`${registry.updatedAt}\`

---

## Active Customer Sites (\`customers/sites-registry.json\`)

| # | Site Code | Customer / Plant Name | Bound Machine ID | License Model | Deployed Version | Release Bundle Asset | Last Packaged |
| :---: | :--- | :--- | :--- | :--- | :---: | :--- | :---: |
${rows || '| - | - | No sites registered | - | - | - | - | - |'}

---

## Quick CLI Commands (Vendor Only)

### 1. List All Registered Customer Sites
\`\`\`powershell
npm run release:customer -- --list
\`\`\`

### 2. Package Pre-Activated ZIP for a Existing Customer Site
\`\`\`powershell
npm run release:customer -- --site="HITACHI-PLANT-01"
\`\`\`

### 3. Register a New Customer Site & Build Pre-Activated Release ZIP
\`\`\`powershell
npm run release:customer -- --site="CUSTOMER-RAYONG-01" --customer="Rayong Transformer Plant" --machine="ITA-XXXX-XXXX-XXXX-XXXX" --type="PERPETUAL" --tanks=4
\`\`\`

### 4. Rebuild All Customer Site Bundles for Current Version (\`v${APP_RELEASE_VERSION}\`)
\`\`\`powershell
npm run release:customer -- --all
\`\`\`

### 5. Publish Core Release + All Customer Bundles to GitHub Releases
\`\`\`powershell
npm run release:github
\`\`\`
`;

  fs.writeFileSync(
    path.join(customersDir, 'CUSTOMER_DEPLOYMENT_REGISTRY.md'),
    md,
    'utf8'
  );
}

function packageSiteBundle(rootDir: string, site: CustomerSiteRecord): string {
  const distReleaseDir = path.join(rootDir, 'dist-release');
  if (!fs.existsSync(path.join(distReleaseDir, 'app', 'ita-engine.dat'))) {
    console.log(
      '[Customer Release] dist-release not found. Running release:pack first...'
    );
    execSync('npx tsx tools/build-release.ts', {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }

  const customerReleasesDir = path.join(rootDir, 'releases', 'customers');
  const stageDir = path.join(customerReleasesDir, `_stage_${site.siteCode}`);
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  // 1. Copy compiled app/ and scripts/ from dist-release
  copyDirRecursive(
    path.join(distReleaseDir, 'app'),
    path.join(stageDir, 'app')
  );
  copyDirRecursive(
    path.join(distReleaseDir, 'scripts'),
    path.join(stageDir, 'scripts')
  );

  // 2. Generate Ed25519 Hardware-Locked License for this site's Machine ID
  const signedLicense = issueSignedLicense({
    customerName: site.customerName,
    machineId: site.machineId,
    licenseType: site.licenseType,
    edition: site.edition,
    maxTanks: site.maxTanks,
    validityDays: site.validityDays,
  });
  const compactToken = encodeLicenseToken(signedLicense);
  const licenseJson = JSON.stringify(signedLicense, null, 2);

  // Embed pre-activated license.lic in data/license/license.lic
  const stageLicenseDir = path.join(stageDir, 'data', 'license');
  fs.mkdirSync(stageLicenseDir, { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'data', 'backups'), { recursive: true });
  fs.writeFileSync(
    path.join(stageLicenseDir, 'license.lic'),
    licenseJson,
    'utf8'
  );
  fs.writeFileSync(
    path.join(
      stageLicenseDir,
      `license-${site.siteCode}-${site.machineId}.lic`
    ),
    licenseJson,
    'utf8'
  );

  // 3. Write SITE_DEPLOYMENT_INFO.txt at root of customer bundle
  const infoTxt = `===============================================================================
 HITACHI ENERGY — ITA PRODUCTION DEPLOYMENT PACKAGE (PRE-ACTIVATED)
===============================================================================
 Site Code          : ${site.siteCode}
 Customer / Plant   : ${site.customerName} (${site.plantLocation})
 Release Version    : v${APP_RELEASE_VERSION}
 Target Machine ID  : ${site.machineId}
 License ID         : ${signedLicense.licenseId}
 License Model      : ${signedLicense.licenseType} (${signedLicense.edition} — Max ${signedLicense.maxTanks} Tanks)
 Issued At          : ${signedLicense.issuedAt}
 Expires At         : ${signedLicense.expiresAt ?? 'NEVER (PERPETUAL)'}
 Packaged At        : ${new Date().toISOString()}
===============================================================================

INSTALLATION INSTRUCTIONS (TARGET IPC: ${site.installPath})
-------------------------------------------------------------------------------
1. Extract this ZIP archive to: ${site.installPath}
   (Note: The hardware-locked license for Machine ID ${site.machineId} is
    ALREADY pre-installed inside data\\license\\license.lic!)

2. Right-click "${site.installPath}\\scripts\\install-windows-service.bat"
   and select "Run as administrator".

3. Open http://localhost:4000 in Microsoft Edge or Google Chrome.

-------------------------------------------------------------------------------
BACKUP COMPACT LICENSE TOKEN (In case manual paste activation is ever needed):
${compactToken}
===============================================================================
`;
  fs.writeFileSync(
    path.join(stageDir, 'SITE_DEPLOYMENT_INFO.txt'),
    infoTxt,
    'utf8'
  );

  // 4. Compress into releases/customers/ITA-v<VERSION>-<SITE_CODE>.zip
  const zipFileName = `ITA-v${APP_RELEASE_VERSION}-${site.siteCode}.zip`;
  const zipFilePath = path.join(customerReleasesDir, zipFileName);
  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
  }
  execSync(
    `powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipFilePath}' -CompressionLevel Optimal -Force"`,
    { stdio: 'inherit' }
  );

  // Clean up temporary staging folder
  fs.rmSync(stageDir, { recursive: true, force: true });

  return zipFilePath;
}

function main() {
  const rootDir = process.cwd();
  const registry = loadRegistry(rootDir);

  if (hasFlag('list')) {
    console.log(
      '==============================================================================='
    );
    console.log(
      ` REGISTERED CUSTOMER DEPLOYMENT SITES (Core Engine v${APP_RELEASE_VERSION})`
    );
    console.log(
      '==============================================================================='
    );
    for (const s of registry.sites) {
      console.log(
        ` - [${s.siteCode}] ${s.customerName} | Machine: ${s.machineId} | ${s.licenseType} (${s.maxTanks} Tanks) | v${s.deployedVersion}`
      );
    }
    console.log(
      '==============================================================================='
    );
    return;
  }

  const siteCodeArg = parseArg('site').toUpperCase();
  const buildAll = hasFlag('all') || !siteCodeArg;

  if (siteCodeArg) {
    let existing = registry.sites.find(
      (s) => s.siteCode.toUpperCase() === siteCodeArg
    );
    const machineArg = parseArg('machine').toUpperCase();
    const customerArg = parseArg('customer');
    const locationArg = parseArg('location');
    const typeArg = parseArg('type').toUpperCase();
    const tanksArg = parseArg('tanks');
    const daysArg = parseArg('days');
    const installPathArg = parseArg('path');
    const notesArg = parseArg('notes');

    if (!existing) {
      if (!machineArg) {
        console.error(
          `ERROR: Site '${siteCodeArg}' is not in customers/sites-registry.json yet. Please provide --machine="ITA-XXXX-XXXX-XXXX-XXXX" and --customer="Customer Name".`
        );
        process.exit(1);
      }
      existing = {
        siteCode: siteCodeArg,
        customerName: customerArg || siteCodeArg,
        plantLocation: locationArg || 'Customer Manufacturing Plant',
        machineId: machineArg,
        licenseType:
          typeArg === 'ANNUAL' || typeArg === 'ANNUAL_SUBSCRIPTION'
            ? 'ANNUAL_SUBSCRIPTION'
            : 'PERPETUAL',
        validityDays: Number(daysArg) || 365,
        edition: 'ENTERPRISE',
        maxTanks: Number(tanksArg) || 4,
        deployedVersion: APP_RELEASE_VERSION,
        installPath: installPathArg || 'D:\\Apps\\ITA',
        lastPackagedAt: new Date().toISOString(),
        notes: notesArg || 'Pre-activated customer deployment bundle',
      };
      registry.sites.push(existing);
    } else {
      if (machineArg) existing.machineId = machineArg;
      if (customerArg) existing.customerName = customerArg;
      if (locationArg) existing.plantLocation = locationArg;
      if (typeArg) {
        existing.licenseType =
          typeArg === 'ANNUAL' || typeArg === 'ANNUAL_SUBSCRIPTION'
            ? 'ANNUAL_SUBSCRIPTION'
            : 'PERPETUAL';
      }
      if (tanksArg) existing.maxTanks = Number(tanksArg) || existing.maxTanks;
      if (daysArg)
        existing.validityDays = Number(daysArg) || existing.validityDays;
      if (installPathArg) existing.installPath = installPathArg;
      if (notesArg) existing.notes = notesArg;
      existing.deployedVersion = APP_RELEASE_VERSION;
      existing.lastPackagedAt = new Date().toISOString();
    }

    const zipPath = packageSiteBundle(rootDir, existing);
    saveRegistry(rootDir, registry);

    console.log(
      '==============================================================================='
    );
    console.log(` CUSTOMER SITE RELEASE PACKAGE READY: ${existing.siteCode}`);
    console.log(
      '==============================================================================='
    );
    console.log(` Customer Name   : ${existing.customerName}`);
    console.log(` Bound Machine   : ${existing.machineId}`);
    console.log(
      ` License Model   : ${existing.licenseType} (${existing.edition}, ${existing.maxTanks} Tanks)`
    );
    console.log(` Pre-Activated   : YES (data/license/license.lic embedded)`);
    console.log(` Output ZIP File : ${zipPath}`);
    console.log(
      '==============================================================================='
    );
    return;
  }

  if (buildAll) {
    console.log(
      `[Customer Release] Packaging pre-activated bundles for all ${registry.sites.length} registered site(s)...`
    );
    for (const site of registry.sites) {
      site.deployedVersion = APP_RELEASE_VERSION;
      site.lastPackagedAt = new Date().toISOString();
      const zipPath = packageSiteBundle(rootDir, site);
      console.log(` -> [${site.siteCode}] Ready: ${zipPath}`);
    }
    saveRegistry(rootDir, registry);
    console.log(
      '==============================================================================='
    );
    console.log(
      ` ALL ${registry.sites.length} CUSTOMER SITE RELEASE BUNDLES GENERATED IN releases/customers/`
    );
    console.log(
      '==============================================================================='
    );
  }
}

main();
