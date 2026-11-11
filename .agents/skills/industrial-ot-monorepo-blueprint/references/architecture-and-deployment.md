# Reference Templates: Industrial OT Monorepo Architecture & Deployment

This reference contains the battle-tested configuration files and scripts used by the `industrial-ot-monorepo-blueprint` skill.

---

## 1. Root `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

---

## 2. Root `package.json` Standard Scripts

```json
{
  "name": "industrial-ot-system",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "postinstall": "node tools/postinstall.cjs",
    "build": "npm run build --workspaces --if-present",
    "dev:backend": "npm --workspace=@scope/backend-service run dev",
    "dev:hmi": "npm --workspace=@scope/frontend-hmi run dev",
    "test": "npm --workspace=@scope/calculation-core run test",
    "license:keygen": "npx tsx tools/license-CLI.ts keygen",
    "license:generate": "npx tsx tools/license-CLI.ts generate",
    "build:release": "npx tsx tools/build-release.ts",
    "release:customer": "npx tsx tools/customer-release.ts",
    "release:github": "npx tsx tools/publish-github-release.ts"
  },
  "devDependencies": {
    "@rollup/wasm-node": "^4.40.0",
    "esbuild": "^0.25.0",
    "esbuild-wasm": "^0.25.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.2"
  }
}
```

---

## 3. Windows 11 Smart App Control WDAC Fallback (`tools/postinstall.cjs`)

Automatically detects if Windows 11 Smart App Control blocks native `.node` addons (`@rollup/rollup-win32-x64-msvc`) and patches Rollup to use `@rollup/wasm-node` while preserving explicit CommonJS named exports (`exports.parse`, `exports.parseAsync`, etc.) for Node.js ESM static analysis:

```javascript
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function ensureRollupWasmFallback() {
  const rollupNativeJs = path.join(rootDir, 'node_modules', 'rollup', 'dist', 'native.js');
  const wasmNativeJs = path.join(rootDir, 'node_modules', '@rollup', 'wasm-node', 'dist', 'native.js');

  if (!fs.existsSync(rollupNativeJs) || !fs.existsSync(wasmNativeJs)) {
    return;
  }

  try {
    require(rollupNativeJs);
    console.log('[Postinstall] Rollup native module loaded OK.');
  } catch (err) {
    const msg = String(err && (err.message || err));
    if (msg.includes('ERR_DLOPEN_FAILED') || msg.includes('Application Control policy') || msg.includes('cannot find module')) {
      console.log('[Postinstall] Windows Smart App Control blocked native Rollup (.node) -> Switching to @rollup/wasm-node (WebAssembly)...');
      const shim = [
        '// Auto-patched by tools/postinstall.cjs for Windows 11 Smart App Control compatibility',
        "const { parse, parseAsync, xxhashBase64Url, xxhashBase36, xxhashBase16, flushLlvmCoverage } = require('@rollup/wasm-node/dist/native.js');",
        'exports.parse = parse;',
        'exports.parseAsync = parseAsync;',
        'exports.xxhashBase64Url = xxhashBase64Url;',
        'exports.xxhashBase36 = xxhashBase36;',
        'exports.xxhashBase16 = xxhashBase16;',
        'exports.flushLlvmCoverage = flushLlvmCoverage;'
      ].join('\n');
      fs.writeFileSync(rollupNativeJs, shim, 'utf8');
      console.log('[Postinstall] Rollup successfully patched to WebAssembly (@rollup/wasm-node).');
    }
  }
}

ensureRollupWasmFallback();
```

---

## 4. AES-256-GCM Binary IP Protection Pattern (`tools/build-release.ts`)

1. Bundle backend + workspace packages + node_modules into a single CJS string using `esbuild.build({ bundle: true, platform: 'node', format: 'cjs' })`.
2. Compress with `zlib.gzipSync(bundleBuffer)` and encrypt with `crypto.createCipheriv('aes-256-gcm', key, iv)`.
3. Write `ita-engine.dat` (`[12-byte IV][16-byte AuthTag][Ciphertext]`).
4. Write `ita-runtime.cjs` loader that decrypts in memory and compiles via `Module._compile(code, filename)`.

---

## 5. Windows Service Native Compilation Pattern (`install-service.bat`)

To avoid Windows 11 Smart App Control blocking downloaded service wrappers, compile a native C# `ServiceBase` host (`ServiceWrapper.cs`) on the target machine using `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` under `NT AUTHORITY\SYSTEM`, then register it in `services.msc` via `sc.exe create`.
