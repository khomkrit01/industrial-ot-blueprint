/**
 * Smart App Control (Windows 11 WDAC) Proof Post-Install Setup (`tools/postinstall.cjs`)
 *
 * Automatically runs after `npm install` on any developer machine:
 *   1. Patches `node_modules/rollup/dist/native.js` so that if Windows 11 Smart App Control
 *      blocks `rollup.win32-x64-msvc.node` (`ERR_DLOPEN_FAILED`), Rollup seamlessly falls back
 *      to `@rollup/wasm-node` (100% pure WebAssembly inside signed `node.exe`).
 *   2. Tests whether `esbuild.exe` is blocked by Windows 11 Smart App Control; if blocked,
 *      automatically switches `esbuild` (both root and Vite's nested copy) to `esbuild-wasm`
 *      (100% pure WebAssembly inside signed `node.exe`).
 *   3. Builds shared TypeScript workspace packages (`contracts` and `calculation-core`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

function patchRollupWithWasmFallback() {
  const rollupNativePath = path.join(rootDir, 'node_modules', 'rollup', 'dist', 'native.js');
  const wasmNativePath = path.join(rootDir, 'node_modules', '@rollup', 'wasm-node', 'dist', 'native.js');

  if (!fs.existsSync(rollupNativePath) || !fs.existsSync(wasmNativePath)) {
    return;
  }

  let nativeWorks = false;
  try {
    require('@rollup/rollup-win32-x64-msvc');
    nativeWorks = true;
  } catch {
    nativeWorks = false;
  }

  const resilientShim = `// Auto-patched by tools/postinstall.cjs for Windows 11 Smart App Control compatibility
let nativeModule;
try {
  nativeModule = require('@rollup/rollup-win32-x64-msvc');
} catch {
  nativeModule = require('@rollup/wasm-node/dist/native.js');
}
const {
  parse,
  parseAsync,
  xxhashBase64Url,
  xxhashBase36,
  xxhashBase16,
  flushLlvmCoverage
} = nativeModule;

exports.parse = parse;
exports.parseAsync = parseAsync;
exports.xxhashBase64Url = xxhashBase64Url;
exports.xxhashBase36 = xxhashBase36;
exports.xxhashBase16 = xxhashBase16;
exports.flushLlvmCoverage = flushLlvmCoverage || (() => {});
`;
  fs.writeFileSync(rollupNativePath, resilientShim, 'utf8');
  console.log(
    nativeWorks
      ? '[Postinstall] Rollup configured with automatic WebAssembly fallback (@rollup/wasm-node).'
      : '[Postinstall] Windows Smart App Control blocked native Rollup (.node) -> Switched to @rollup/wasm-node (WebAssembly).'
  );
}

function patchEsbuildIfBlockedBySmartAppControl() {
  const wasmPkgDir = path.join(rootDir, 'node_modules', 'esbuild-wasm');
  if (!fs.existsSync(wasmPkgDir)) return;

  const esbuildTargets = [
    {
      pkgDir: path.join(rootDir, 'node_modules', 'esbuild'),
      exePath: path.join(rootDir, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    },
    {
      pkgDir: path.join(rootDir, 'node_modules', 'vite', 'node_modules', 'esbuild'),
      exePath: path.join(
        rootDir,
        'node_modules',
        'vite',
        'node_modules',
        '@esbuild',
        'win32-x64',
        'esbuild.exe'
      ),
    },
  ];

  for (const target of esbuildTargets) {
    if (!fs.existsSync(target.pkgDir)) continue;

    let exeWorks = false;
    if (fs.existsSync(target.exePath)) {
      const res = spawnSync(target.exePath, ['--version'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      });
      if (!res.error && res.status === 0) {
        exeWorks = true;
      }
    }

    if (!exeWorks) {
      // Copy esbuild-wasm files into target.pkgDir so it runs via signed node.exe + WebAssembly
      fs.mkdirSync(path.join(target.pkgDir, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(target.pkgDir, 'lib'), { recursive: true });

      for (const file of ['esbuild.wasm', 'wasm_exec.js', 'wasm_exec_node.js']) {
        const src = path.join(wasmPkgDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(target.pkgDir, file));
        }
      }
      const wasmBin = path.join(wasmPkgDir, 'bin', 'esbuild');
      if (fs.existsSync(wasmBin)) {
        fs.copyFileSync(wasmBin, path.join(target.pkgDir, 'bin', 'esbuild'));
      }
      const wasmMain = path.join(wasmPkgDir, 'lib', 'main.js');
      if (fs.existsSync(wasmMain)) {
        fs.copyFileSync(wasmMain, path.join(target.pkgDir, 'lib', 'main.js'));
      }
      console.log(
        `[Postinstall] Windows Smart App Control blocked ${path.relative(rootDir, target.exePath)} -> Switched ${path.relative(rootDir, target.pkgDir)} to esbuild-wasm (WebAssembly).`
      );
    }
  }
}

function buildSharedWorkspacePackages() {
  console.log('[Postinstall] Building shared workspace packages (contracts & calculation-core)...');
  execSync(
    'npm run build --workspace=@transformer-impregnation-system/contracts --workspace=@transformer-impregnation-system/calculation-core',
    { cwd: rootDir, stdio: 'inherit' }
  );
}

function main() {
  patchRollupWithWasmFallback();
  patchEsbuildIfBlockedBySmartAppControl();
  buildSharedWorkspacePackages();
}

main();
