/**
 * Vendor CLI Tool: Ed25519 Hardware-Locked Commercial License Generator
 * Supports both:
 *   1. PERPETUAL License (ขายขาดถาวร — expiresAt: null)
 *   2. ANNUAL_SUBSCRIPTION License (ต่ออายุรายปี — expiresAt: ISO-8601 date)
 *
 * Usage Examples:
 *   npm run license:keygen -- --machine="ITA-XXXX-XXXX-XXXX-XXXX" --customer="Hitachi Energy Plant 1" --type="PERPETUAL"
 *   npm run license:keygen -- --machine="ITA-XXXX-XXXX-XXXX-XXXX" --customer="Customer Co." --type="ANNUAL_SUBSCRIPTION" --days=365
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  encodeLicenseToken,
  getHardwareMachineId,
  issueSignedLicense,
} from '../packages/backend-service/src/license';
import { LicenseType } from '../packages/contracts/src';

function parseArg(flag: string, fallback: string): string {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length).replace(/^["']|["']$/g, '');
  }
  return fallback;
}

function main() {
  const localMachineId = getHardwareMachineId();
  const machineId = parseArg('machine', localMachineId).toUpperCase();
  const customerName = parseArg(
    'customer',
    'Hitachi Energy Transformer Manufacturing Plant'
  );
  const rawType = parseArg('type', 'PERPETUAL').toUpperCase();
  const licenseType: LicenseType =
    rawType === 'ANNUAL' || rawType === 'ANNUAL_SUBSCRIPTION'
      ? 'ANNUAL_SUBSCRIPTION'
      : 'PERPETUAL';
  const edition =
    parseArg('edition', 'ENTERPRISE').toUpperCase() === 'STANDARD'
      ? 'STANDARD'
      : 'ENTERPRISE';
  const maxTanks = Math.max(1, Number(parseArg('tanks', '4')) || 4);
  const validityDays = Math.max(1, Number(parseArg('days', '365')) || 365);
  const outFile = parseArg(
    'out',
    path.resolve(
      process.cwd(),
      'data',
      'license',
      `license-${machineId}-${licenseType.toLowerCase()}.lic`
    )
  );

  const signedPayload = issueSignedLicense({
    customerName,
    machineId,
    licenseType,
    edition,
    maxTanks,
    validityDays,
  });

  const token = encodeLicenseToken(signedPayload);
  const jsonContent = JSON.stringify(signedPayload, null, 2);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, jsonContent, 'utf8');

  // Also write active license.lic if requested for local machine
  const activateLocal = parseArg('activate', 'true').toLowerCase() !== 'false';
  if (activateLocal && machineId === localMachineId) {
    const activeLicPath = path.resolve(
      process.cwd(),
      'data',
      'license',
      'license.lic'
    );
    fs.writeFileSync(activeLicPath, jsonContent, 'utf8');
  }

  console.log('=============================================================');
  console.log(' ITA COMMERCIAL LICENSE KEY GENERATOR (Ed25519 HARDWARE LOCK)');
  console.log('=============================================================');
  console.log(` License ID      : ${signedPayload.licenseId}`);
  console.log(` Customer Name   : ${signedPayload.customerName}`);
  console.log(` Machine ID      : ${signedPayload.machineId}`);
  console.log(
    ` License Model   : ${
      signedPayload.licenseType === 'PERPETUAL'
        ? 'PERPETUAL (Never Expires)'
        : `ANNUAL_SUBSCRIPTION (${validityDays} Days)`
    }`
  );
  console.log(` Issued At       : ${signedPayload.issuedAt}`);
  console.log(
    ` Expires At      : ${signedPayload.expiresAt ?? 'NEVER (PERPETUAL)'}`
  );
  console.log(` Edition / Tanks : ${signedPayload.edition} (${signedPayload.maxTanks} Tanks)`);
  console.log(` Saved .lic File : ${outFile}`);
  console.log('-------------------------------------------------------------');
  console.log(' Compact License Token (for copy-paste activation):');
  console.log(` ${token}`);
  console.log('=============================================================');
}

main();
