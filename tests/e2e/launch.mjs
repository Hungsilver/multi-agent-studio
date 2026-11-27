// Khởi chạy bản build (out/) với kịch bản E2E và CLI giả. Cần `npm run build` trước.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-e2e-out-'))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-e2e-data-'))
const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

const res = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  timeout: 240_000,
  env: {
    ...process.env,
    E2E_DIR: here,
    E2E_OUT: out,
    FAKE_CLI_LOG: path.join(out, 'calls.jsonl'),
    AICT_E2E_SCRIPT: path.join(here, 'run.mjs'),
    AI_CODING_TOOL_DATA: data
  }
})
console.log(`Kết quả & ảnh chụp: ${out}`)
process.exit(res.status ?? 1)
