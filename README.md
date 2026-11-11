# Industrial OT / HMI Monorepo Blueprint & Agent Skill (`industrial-ot-blueprint`)

แม่แบบสถาปัตยกรรมซอฟต์แวร์ระดับอุตสาหกรรม (Industrial OT / SCADA / HMI Monorepo) พร้อม **Antigravity Agent Skill (`industrial-ot-monorepo-blueprint`)** สำหรับใช้งานทั้ง **2 รูปแบบ**:
1. **เริ่มต้นโปรเจกต์ใหม่ตั้งแต่ศูนย์ (Scaffold New Project)**
2. **ปรับโครงสร้าง/อัปเกรดโปรเจกต์เดิมที่มีอยู่แล้ว (Refactor / Upgrade Existing Project)**

---

## จุดเด่นของสถาปัตยกรรมในแม่แบบนี้ (6 Pillars)

1. **TypeScript Monorepo 4 เลเยอร์ (`packages/*`)**:
   - `packages/contracts`: Zod Schemas เป็น Single Source of Truth สำหรับ REST API, Socket.IO และ RBAC Roles (`admin`, `operator`, `viewer`, `superadmin`)
   - `packages/calculation-core`: สูตรคำนวณวิศวกรรมและ State Machine แบบ Pure TypeScript (Zero I/O) ทดสอบด้วย `vitest`
   - `packages/backend-service`: Fastify 5 + Socket.IO 4, Offline Air-Gapped Ready, Audit Log
   - `packages/frontend-hmi`: React 19 + Vite 6, Industrial Dark UI, สลับภาษา `TH`/`EN` ทันที, ไม่พึ่งพา CDN ภายนอก
2. **ป้องกันการขโมย Source Code 100% (`tools/build-release.ts`)**:
   - รวมโค้ดและ Dependencies ทั้งหมดเป็นก้อนเดียวแล้วเข้ารหัสด้วย **AES-256-GCM** (`app/ita-engine.dat` + `app/ita-runtime.cjs`) ไม่ต้องมีโฟลเดอร์ `node_modules` หรือไฟล์ `.ts` บนเครื่องลูกค้า
3. **ระบบล็อกรหัสเครื่อง Offline License (`tools/license-CLI.ts`)**:
   - ใช้กุญแจอสมมาตร **Ed25519** ผูกกับรหัสฮาร์ดแวร์เมนบอร์ด/ซีพียูของเครื่อง IPC โรงงาน (`Machine ID`)
4. **รองรับ Windows 11 Smart App Control / WDAC 100%**:
   - **ฝั่งเครื่องนักพัฒนา (`tools/postinstall.cjs`)**: ตรวจจับอัตโนมัติเมื่อ Windows 11 บล็อกไฟล์ `.node` ของ Rollup แล้วสลับไปใช้ WebAssembly (`@rollup/wasm-node`) ทันที
   - **ฝั่งเครื่องโรงงาน (`install-windows-service.bat`)**: คอมไพล์ Windows Service Wrapper (`.exe`) ด้วย C# ภายใต้สิทธิ์ `NT AUTHORITY\SYSTEM` บนเครื่องปลายทาง ทำให้รันใน `services.msc` ได้โดยไม่ติดบล็อก Error 4551
5. **ระบบแพ็กเกจส่งมอบลูกค้ารายโรงงาน (`tools/customer-release.ts` & `customers/sites-registry.json`)**:
   - สร้างไฟล์ ZIP พร้อมฝัง License รายโรงงานและอัปโหลดขึ้น GitHub Releases อัตโนมัติ

---

## รูปแบบที่ 1: เริ่มต้นโปรเจกต์ใหม่ตั้งแต่ศูนย์ (Start a New Project)

### ขั้นตอนที่ 1: Clone แม่แบบนี้ไปยังโฟลเดอร์โปรเจกต์ใหม่ของคุณ
```powershell
git clone https://github.com/khomkrit01/industrial-ot-blueprint.git my-new-ot-project
cd my-new-ot-project
Remove-Item -Recurse -Force .git
git init
```

### ขั้นตอนที่ 2: เปิดใน Antigravity IDE แล้วสั่ง Agent
เปิดโฟลเดอร์ `my-new-ot-project` ใน Antigravity IDE จากนั้นพิมพ์คำสั่งนี้ในช่องแชท:

> **"ใช้ skill `industrial-ot-monorepo-blueprint` เพื่อสร้างระบบ [ชื่อโปรเจกต์ใหม่ของคุณ] โดยมีรายละเอียดฟีเจอร์และหน้าจอ HMI ดังนี้: [อธิบายความต้องการของคุณ]"**

Agent จะอ่านไฟล์ [`.agents/skills/industrial-ot-monorepo-blueprint/SKILL.md`](./.agents/skills/industrial-ot-monorepo-blueprint/SKILL.md) และสร้างโครงสร้าง `packages/contracts`, `packages/calculation-core`, `packages/backend-service`, และ `packages/frontend-hmi` ตามมาตรฐานเดียวกันทั้งหมดโดยอัตโนมัติ

---

## รูปแบบที่ 2: ปรับโครงสร้างโปรเจกต์เดิมที่มีอยู่แล้ว (Upgrade / Refactor Existing Project)

หากคุณมีโปรเจกต์เดิมอยู่แล้ว (เช่นอยู่ที่ `D:\Apps\my-existing-app`) และต้องการให้ Agent ปรับโครงสร้างให้เป็นมาตรฐานนี้:

### ขั้นตอนที่ 1: รันสคริปต์ฉีด Skill และ Tools เข้าสู่โปรเจกต์เดิม
เปิด PowerShell แล้วรันคำสั่งนี้:

```powershell
git clone https://github.com/khomkrit01/industrial-ot-blueprint.git "$env:TEMP\ot-blueprint"
powershell -ExecutionPolicy Bypass -File "$env:TEMP\ot-blueprint\scripts\inject-into-existing-project.ps1" -TargetProjectPath "D:\Apps\my-existing-app"
Remove-Item -Recurse -Force "$env:TEMP\ot-blueprint"
```

*(หรือหากต้องการติดตั้ง Skill นี้ไว้แบบ Global บนเครื่องคอมพิวเตอร์เครื่องใหม่ เพื่อให้ทุกโปรเจกต์ในเครื่องเรียกใช้ได้ตลอดเวลา ให้รันคำสั่งนี้ครั้งเดียวต่อเครื่อง):*
```powershell
git clone https://github.com/khomkrit01/industrial-ot-blueprint.git "$env:TEMP\ot-blueprint"
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\skills" | Out-Null
Copy-Item -Path "$env:TEMP\ot-blueprint\.agents\skills\industrial-ot-monorepo-blueprint" -Destination "$HOME\.gemini\config\skills\industrial-ot-monorepo-blueprint" -Recurse -Force
Remove-Item -Recurse -Force "$env:TEMP\ot-blueprint"
```

### ขั้นตอนที่ 2: เปิดโปรเจกต์เดิมใน Antigravity IDE แล้วสั่ง Agent
เปิดโฟลเดอร์โปรเจกต์เดิม (`D:\Apps\my-existing-app`) ใน Antigravity IDE แล้วพิมพ์สั่ง Agent ว่า:

> **"ใช้ skill `industrial-ot-monorepo-blueprint` เพื่อตรวจสอบและปรับโครงสร้างโปรเจกต์นี้ให้เป็นมาตรฐาน Industrial OT Monorepo พร้อมเพิ่มระบบเข้ารหัส Release (AES-256-GCM), ระบบ Ed25519 License, Windows Service และตัวป้องกัน Windows 11 Smart App Control"**

---

## โครงสร้างไฟล์ใน Repository แม่แบบนี้

```text
industrial-ot-blueprint/
├── .agents/
│   └── skills/
│       └── industrial-ot-monorepo-blueprint/
│           ├── SKILL.md                                 # คู่มือคำสั่งหลักสำหรับ AI Agent
│           └── references/
│               └── architecture-and-deployment.md       # โค้ดต้นแบบสำหรับ Agent
├── scripts/
│   └── inject-into-existing-project.ps1                 # สคริปต์ติดตั้ง Skill & Tools เข้าโปรเจกต์เดิมในคำสั่งเดียว
├── tools/
│   ├── postinstall.cjs                                  # ระบบสลับ Rollup WebAssembly อัตโนมัติบน Windows 11 WDAC
│   ├── build-release.ts                                 # ตัวเข้ารหัสไบนารี AES-256-GCM & สร้าง Windows Service
│   ├── license-CLI.ts                                   # ตัวสร้างกุญแจและออกใบอนุญาต Ed25519
│   ├── customer-release.ts                              # ตัวแพ็กเกจ ZIP แยกตามโรงงานลูกค้า
│   └── publish-github-release.ts                        # ตัวอัปโหลด Release ขึ้น GitHub อัตโนมัติ
├── customers/
│   └── sites-registry.json                              # ทะเบียนรหัสเครื่องลูกค้าตัวอย่าง
├── package.json                                         # สคริปต์มาตรฐานระดับ Root Monorepo
└── tsconfig.base.json                                   # ตั้งค่า TypeScript Strict Mode มาตรฐาน
```
