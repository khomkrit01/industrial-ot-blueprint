/**
 * Automated GitHub Release & Customer Bundle Publisher (`tools/publish-github-release.ts`)
 *
 * Uses the authenticated GitHub credentials from Git Credential Manager (`git credential fill`)
 * or `GITHUB_TOKEN` environment variable to:
 *   1. Create or update the GitHub Release for `v<APP_RELEASE_VERSION>` on `khomkrit01/ita`
 *   2. Attach the Master Core Release ZIP (`ITA-Production-Release-v<VERSION>.zip`)
 *   3. Attach all Pre-Activated Customer Site ZIP bundles (`ITA-v<VERSION>-<SITE_CODE>.zip`)
 *   4. Include a structured Customer Deployment Registry table in the GitHub Release Notes
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { APP_RELEASE_VERSION } from '../packages/backend-service/src/license';
import { loadRegistry } from './customer-release';

function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    const out = execSync(
      'git credential fill',
      {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );
    const match = out.match(/^password=(.+)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // Fallback error below
  }
  throw new Error(
    'Could not retrieve GitHub token from Git Credential Manager or GITHUB_TOKEN env var.'
  );
}

function getRepoOwnerAndName(): { owner: string; repo: string } {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf8',
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // Default
  }
  return { owner: 'khomkrit01', repo: 'ita' };
}

async function uploadReleaseAsset(
  uploadUrlTemplate: string,
  token: string,
  existingAssets: Array<{ id: number; name: string }>,
  owner: string,
  repo: string,
  filePath: string
) {
  const fileName = path.basename(filePath);
  const prev = existingAssets.find((a) => a.name === fileName);
  if (prev) {
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/assets/${prev.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ITA-Release-Publisher',
        },
      }
    );
  }

  const baseUploadUrl = uploadUrlTemplate.replace(/\{\?.*\}$/, '');
  const uploadUrl = `${baseUploadUrl}?name=${encodeURIComponent(fileName)}`;
  const fileBuffer = fs.readFileSync(filePath);

  console.log(
    `[GitHub Release] Uploading asset: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)...`
  );
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/zip',
      'Content-Length': String(fileBuffer.length),
      'User-Agent': 'ITA-Release-Publisher',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to upload ${fileName}: ${res.status} ${errText}`);
  }
}

async function main() {
  const rootDir = process.cwd();
  const tag = `v${APP_RELEASE_VERSION}`;
  const { owner, repo } = getRepoOwnerAndName();
  const token = getGitHubToken();
  const registry = loadRegistry(rootDir);

  const masterZip = path.join(
    rootDir,
    'releases',
    `ITA-Production-Release-v${APP_RELEASE_VERSION}.zip`
  );
  if (!fs.existsSync(masterZip)) {
    console.log('[GitHub Release] Building master release ZIP...');
    execSync('npx tsx tools/build-release.ts', {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }

  // Also ensure customer bundles are up to date
  execSync('npx tsx tools/customer-release.ts --all', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  const customerRows = registry.sites
    .map(
      (s) =>
        `| **\`${s.siteCode}\`** | ${s.customerName} (${s.plantLocation}) | \`${s.machineId}\` | \`${s.licenseType}\` (${s.maxTanks} Tanks) | **\`ITA-v${APP_RELEASE_VERSION}-${s.siteCode}.zip\`** (Pre-Activated) |`
    )
    .join('\n');

  const releaseBody = `## Hitachi Energy — ITA Impregnation Tracking System (\`${tag}\`)

### 1. Master Core Production Installer (Unactivated / Universal)
- **File:** \`ITA-Production-Release-${tag}.zip\`
- **Engine Architecture:** 100% Self-Contained AES-256-GCM Encrypted Binary (\`app/ita-engine.dat\`) + In-RAM Loader (\`app/ita-runtime.cjs\`) — **Zero \`node_modules\` required on target PC**
- **Windows Service:** Native \`services.msc\` Windows Service (\`Hitachi Energy - ITA Impregnation Tracking System\`) compatible with Windows 11 Smart App Control (\`Error 4551\` proof)

---

### 2. Customer-Specific Pre-Activated Deployment Packages
Each customer ZIP below already includes the Ed25519 hardware-locked \`data/license/license.lic\` pre-installed for that plant's IPC Machine ID:

| Site Code | Customer / Plant | Bound Machine ID | License Model | Downloadable Asset |
| :--- | :--- | :--- | :--- | :--- |
${customerRows || '| - | - | - | - | - |'}

---

### Quick Deployment Steps on Target IPC (\`D:\\Apps\\ITA\`)
1. Extract the customer ZIP (e.g. \`ITA-${tag}-HITACHI-PLANT-01.zip\`) to \`D:\\Apps\\ITA\`
2. Right-click \`D:\\Apps\\ITA\\scripts\\install-windows-service.bat\` -> **Run as administrator**
3. Open \`http://localhost:4000\`
`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'ITA-Release-Publisher',
  };

  // Check if release for tag already exists
  let releaseData: {
    id: number;
    upload_url: string;
    html_url: string;
    assets: Array<{ id: number; name: string }>;
  };

  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { headers }
  );

  if (getRes.ok) {
    const existing = (await getRes.json()) as typeof releaseData;
    const updateRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/${existing.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          tag_name: tag,
          name: `${tag} — Production Release & Customer Site Packages`,
          body: releaseBody,
          draft: false,
          prerelease: false,
        }),
      }
    );
    if (!updateRes.ok) {
      throw new Error(
        `Failed to update release: ${updateRes.status} ${await updateRes.text()}`
      );
    }
    releaseData = (await updateRes.json()) as typeof releaseData;
  } else {
    const createRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: 'main',
          name: `${tag} — Production Release & Customer Site Packages`,
          body: releaseBody,
          draft: false,
          prerelease: false,
        }),
      }
    );
    if (!createRes.ok) {
      throw new Error(
        `Failed to create release: ${createRes.status} ${await createRes.text()}`
      );
    }
    releaseData = (await createRes.json()) as typeof releaseData;
  }

  // Upload Master ZIP
  await uploadReleaseAsset(
    releaseData.upload_url,
    token,
    releaseData.assets || [],
    owner,
    repo,
    masterZip
  );

  // Upload all Customer Site ZIPs for this version
  const customerZipDir = path.join(rootDir, 'releases', 'customers');
  if (fs.existsSync(customerZipDir)) {
    const files = fs
      .readdirSync(customerZipDir)
      .filter((f) => f.startsWith(`ITA-v${APP_RELEASE_VERSION}-`) && f.endsWith('.zip'));
    for (const file of files) {
      await uploadReleaseAsset(
        releaseData.upload_url,
        token,
        releaseData.assets || [],
        owner,
        repo,
        path.join(customerZipDir, file)
      );
    }
  }

  console.log(
    '==============================================================================='
  );
  console.log(` GITHUB RELEASE PUBLISHED SUCCESSFULLY!`);
  console.log(` Release URL: ${releaseData.html_url}`);
  console.log(
    '==============================================================================='
  );
}

main().catch((err) => {
  console.error('[GitHub Release Error]', err);
  process.exit(1);
});
