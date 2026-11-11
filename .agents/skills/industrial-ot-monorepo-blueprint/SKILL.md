---
name: industrial-ot-monorepo-blueprint
description: >-
  Blueprint and architectural standard for Industrial OT / SCADA / HMI TypeScript monorepo systems.
  Use this skill when the user asks to scaffold a new industrial OT/HMI project, migrate or refactor
  an existing project to match the ITA Industrial Architecture, or implement Ed25519 hardware-locked
  licensing, AES-256-GCM binary IP protection, Windows Service C# wrappers, or Windows 11 Smart App
  Control (WDAC) WebAssembly fallbacks.
---

# Industrial OT / HMI Monorepo Architecture Skill (`industrial-ot-monorepo-blueprint`)

This skill defines the complete architecture, tech stack, coding standards, security/licensing model, and production release pipeline proven in the **ITA Industrial Tracking & Control System**. Use this blueprint either to **scaffold a brand-new project from scratch** or to **refactor/upgrade an existing project** to production-grade Industrial OT standards.

---

## 1. Core Technology Stack & Language Standards

| Layer | Technology & Version | Architectural Rule |
| :--- | :--- | :--- |
| **Monorepo Manager** | **npm Workspaces** (`packages/*`) | Root `package.json` orchestrates builds, tests, dev servers, and release pipelines. |
| **Language** | **TypeScript 5.8+ (`strict: true`)** | ESM (`"type": "module"`, `"moduleResolution": "bundler"` or `"NodeNext"`). Zero `any` in domain/contracts. |
| **Shared Contracts** | **Zod (`packages/contracts`)** | Single source of truth for DTOs, API payloads, Socket.IO events, and RBAC roles. Inferred TypeScript types via `z.infer<typeof Schema>`. |
| **Calculation / Domain Core** | **Pure TypeScript (`packages/calculation-core`)** | Zero I/O, zero network/DB dependencies. Deterministic math, physics, state machines, and validation with 100% unit testability (`vitest`). |
| **Backend OT Service** | **Fastify 5 + Socket.IO 4 (`packages/backend-service`)** | High-throughput REST API + real-time WebSocket telemetry, Append-only JSONL/SQLite persistence, RBAC auth, Audit Trail, and Ed25519 License Guard. |
| **Frontend Industrial HMI** | **React 19 + Vite 6 (`packages/frontend-hmi`)** | High-contrast Industrial Dark UI, 60fps Canvas/SVG gauges & P&ID synoptics, Bilingual (`TH` / `EN`), Role-based view guards, Offline-first local assets (zero CDN dependencies). |
| **Windows Service Host** | **Native C# `.NET Framework 4.x` (`ServiceWrapper.cs`)** | Compiles on-the-fly during deployment via built-in Windows `csc.exe` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) under `NT AUTHORITY\SYSTEM` to bypass Windows 11 Smart App Control (WDAC). |

---

## 2. Standard Monorepo Directory Layout

When creating a new project or restructuring an existing repository, organize files into this exact structure:

```text
<project-root>/
├── package.json                     # Workspaces root + unified scripts (dev, build, release, license)
├── tsconfig.base.json               # Shared strict TypeScript compiler configuration
├── customers/
│   ├── sites-registry.json          # Master registry of customer sites, Machine IDs, tiers, expiry
│   └── CUSTOMER_DEPLOYMENT_REGISTRY.md
├── keys/                            # GIT-IGNORED private keys (Ed25519 private.pem / public.pem)
├── tools/
│   ├── postinstall.cjs              # Windows 11 Smart App Control WDAC auto-detector & WASM fallback
│   ├── build-release.ts             # Bundler + AES-256-GCM encryptor -> dist-release/
│   ├── license-CLI.ts               # Ed25519 keygen & offline customer license generator
│   ├── customer-release.ts          # 1-Command customer site ZIP packager
│   └── publish-github-release.ts    # Automated GitHub Release uploader
└── packages/
    ├── contracts/                   # Shared Zod schemas, RBAC permissions, telemetry types
    ├── calculation-core/            # Pure domain logic, formulas, alarm evaluation, unit tests
    ├── backend-service/             # Fastify + Socket.IO server, persistence, hardware fingerprint
    └── frontend-hmi/                # React 19 + Vite industrial HMI dashboard
```

---

## 3. Mandatory Architectural Patterns

When generating or refactoring code, always enforce these 6 pillars (see [references/architecture-and-deployment.md](./references/architecture-and-deployment.md) for code templates):

### Pillar 1: Contract-First Development (`packages/contracts`)
1. Every API endpoint, WebSocket event, configuration setting, and user role MUST be defined as a **Zod schema** in `packages/contracts/src/index.ts` first.
2. Export both the runtime Zod schema (`SchemaName`) and compile-time TypeScript type (`export type Name = z.infer<typeof SchemaName>`).
3. Both `backend-service` and `frontend-hmi` import exclusively from `@<scope>/contracts`.

### Pillar 2: Pure Deterministic Core (`packages/calculation-core`)
1. Separate all engineering formulas, process curves, PID/control math, and safety interlock evaluations into `packages/calculation-core`.
2. Never import `fs`, `http`, `fastify`, or database drivers inside `calculation-core`.
3. Write comprehensive `vitest` suites for every calculation function.

### Pillar 3: Industrial OT Reliability & Security (`packages/backend-service`)
1. **Air-Gapped Ready**: Never rely on external internet connectivity at runtime.
2. **RBAC & Default Accounts**: Support 4 standard industrial tiers out of the box:
   - `admin` (System Administrator / Engineer)
   - `operator` (Plant Floor Control Operator)
   - `viewer` (Read-Only Dashboard / Management)
   - `superadmin` (Vendor / OEM Support & Diagnostics)
3. **Tamper-Evident Persistence**: Use atomic file writes or WAL-mode storage with automatic backup rotation and immutable audit logs (`audit-log.jsonl`).
4. **Static HMI Serving**: In production (`NODE_ENV=production`), `backend-service` serves the compiled `frontend-hmi` static bundle directly on the same port (`3001`) so only a single port/process is needed on the factory PC.

### Pillar 4: Industrial HMI UX & Aesthetics (`packages/frontend-hmi`)
1. **Industrial Dark Theme**: Deep slate/navy surfaces (`#0a0e17`, `#111827`), high-visibility semantic status colors (Normal = Emerald `#10b981`, Warning = Amber `#f59e0b`, Alarm/Trip = Crimson `#ef4444`, Active/Selected = Cyan `#06b6d4`).
2. **Bilingual Instant Toggle (`TH` / `EN`)**: Central dictionary store allowing plant operators to switch between Thai and English without reloading.
3. **Zero External Fonts/CDNs**: Bundle all icons (inline SVG) and styles locally for 100% offline factory floor operation.

### Pillar 5: Commercial IP Protection & Offline Licensing (`tools/build-release.ts` & `tools/license-CLI.ts`)
1. **Zero Source Code Exposure**:
   - Bundle `backend-service`, `calculation-core`, `contracts`, and all runtime npm dependencies into a single standalone CommonJS bundle using `esbuild`.
   - Encrypt the bundle with **AES-256-GCM** into `dist-release/app/ita-engine.dat` and generate a tiny loader `dist-release/app/ita-runtime.cjs` that decrypts and executes it in memory (`vm`/`Module._compile`).
   - Strip `private.pem` from `dist-release/` — ship only `public.pem` (or embed the public key).
2. **Hardware-Bound Ed25519 License (`license.key`)**:
   - Fingerprint the target machine using motherboard UUID / BIOS Serial / CPU ID / Disk Serial (`getMachineFingerprint()`).
   - Sign license payloads (`customerName`, `siteId`, `machineId`, `tier`, `expiresAt`, `maxTanks`, `features`) offline using **Ed25519** (`crypto.sign(null, payloadBuffer, privateKey)`).
   - Verify signature offline at startup and periodically at runtime using the public key.

### Pillar 6: Windows 11 Smart App Control (WDAC) Compatibility
Modern Windows 11 Industrial PCs often enforce **Smart App Control**, which blocks unsigned native `.node` addons (like `@rollup/rollup-win32-x64-msvc`) and downloaded 3rd-party `.exe` service wrappers (like `nssm.exe`).
1. **Developer Machine Resilience (`tools/postinstall.cjs`)**:
   - Always include `@rollup/wasm-node` and `esbuild-wasm` in root `devDependencies`.
   - In `postinstall`, run `tools/postinstall.cjs` to test loading Rollup's native `.node` addon; if blocked by `ERR_DLOPEN_FAILED`, automatically patch `node_modules/rollup/dist/native.js` to re-export `@rollup/wasm-node/dist/native.js` with explicit CJS named exports (`exports.parse = parse; exports.parseAsync = parseAsync; ...`) for Node ESM compatibility, then build `contracts` and `calculation-core`.
2. **Production Windows Service (`install-service.bat`)**:
   - Never ship pre-compiled unsigned `.exe` wrappers.
   - Instead, generate a clean C# `ServiceBase` wrapper (`ServiceWrapper.cs`) inside `install-service.bat` and compile it locally **as `NT AUTHORITY\SYSTEM`** using `PsExec` / Scheduled Task + Windows built-in `csc.exe`, so the resulting binary inherits local machine trust and runs cleanly in `services.msc`.

---

## 4. Step-by-Step Workflows for the Agent

### Workflow A: Scaffolding a New Project from Scratch
1. Create the root `package.json` with npm workspaces (`packages/*`), `tsconfig.base.json`, and `.gitignore` (ignoring `node_modules/`, `dist/`, `dist-release/`, `releases/`, `keys/private.pem`).
2. Create `tools/postinstall.cjs` with the Windows 11 Smart App Control WebAssembly fallback and workspace build trigger.
3. Scaffold the 4 workspace packages in dependency order:
   - `packages/contracts` -> build (`tsc -b`)
   - `packages/calculation-core` -> build & run unit tests (`vitest run`)
   - `packages/backend-service` -> wire Fastify, Socket.IO, RBAC, and license verification
   - `packages/frontend-hmi` -> wire React 19, Vite, bilingual store, and real-time Socket.IO hooks
4. Add commercial tooling in `tools/` (`license-CLI.ts`, `build-release.ts`, `customer-release.ts`) and `customers/sites-registry.json`.
5. Run `npm install`, `npm test`, and `npm run build` to verify the entire monorepo compiles cleanly.

### Workflow B: Refactoring / Upgrading an Existing Project to This Architecture
> **CRITICAL RULE FOR EXISTING PROJECTS (UI & Layout Preservation):**
> - **DO NOT overwrite or replace existing UI layouts, menu structures, navigation patterns, color themes, or domain screens** unless the user explicitly asks to redesign the UI.
> - Always **Audit -> Compare -> Create a Plan First** and wait for user approval before moving files or altering code.

1. **Step 1 — Read & Audit Current Repo (Non-Destructive)**:
   - Inspect existing directory structure, UI components, menu/navigation layout, state management, backend routes, and build scripts.
   - Identify what the user has already designed (especially custom Menu Layouts, Pages, and Domain Logic) so they are **100% preserved**.
2. **Step 2 — Compare & Propose an Implementation Plan (Wait for Confirmation)**:
   - Present a side-by-side comparison table showing:
     - **Keep As-Is (Preserved)**: Existing UI Menu Layout, existing screens/components, existing business formulas.
     - **Restructure / Wrap**: Moving or wiring existing Frontend into `packages/frontend-hmi`, Backend into `packages/backend-service`, shared types into `packages/contracts`, and pure logic into `packages/calculation-core`.
     - **Add Missing Infrastructure**: Adding `tools/postinstall.cjs` (WDAC WebAssembly fallback), `tools/build-release.ts` (AES-256-GCM binary encryption + Windows Service), `tools/license-keygen.ts` (Ed25519 hardware-locked licensing), and `customers/sites-registry.json`.
   - Ask the user to confirm the plan before executing structural changes.
3. **Step 3 — Execute Incremental Migration**:
   - Move/wrap existing code according to the approved plan while keeping the existing Menu Layout and UI screens intact.
   - Wire in the Ed25519 License Guard/Modal (for example, as a non-intrusive tab or header badge inside the user's existing menu layout).
4. **Step 4 — Verify End-to-End**:
   - Verify `npm test`, `npm run build`, and `npm run build:release` produce a working encrypted `dist-release/` package without breaking any existing UI layout.
