import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type Env = Record<string, string | undefined>

/** Tìm Code.exe trực tiếp (không đi qua code.cmd + shell). `AICT_VSCODE_PATH` cho phép chỉ định launcher thủ công/kiểm thử. */
export function findVsCodeLauncher(env: Env = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const candidates: string[] = []
  if (env.AICT_VSCODE_PATH) candidates.push(env.AICT_VSCODE_PATH)
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (base) candidates.push(path.join(base, 'Microsoft VS Code', 'Code.exe'))
  }
  // Cài tùy chỉnh: tìm code.cmd trong PATH rồi lấy Code.exe nằm ở thư mục cha của bin\
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    if (exists(path.join(dir, 'code.cmd'))) candidates.push(path.join(dir, '..', 'Code.exe'))
  }
  return candidates.find((c) => exists(c)) ?? null
}

export interface OpenVsCodeDeps {
  env?: Env
  exists?: (p: string) => boolean
  spawnFn?: (file: string, args: string[], options: Record<string, unknown>) => ChildProcess
}

/** Mở thư mục/file bằng VS Code; đường dẫn được truyền như một đối số riêng, không qua shell. */
export async function openInVsCode(targetPath: string, deps: OpenVsCodeDeps = {}): Promise<void> {
  const exists = deps.exists ?? fs.existsSync
  if (!targetPath || !path.isAbsolute(targetPath) || !exists(targetPath)) {
    throw new Error(`Đường dẫn không hợp lệ hoặc không tồn tại: ${targetPath || '(trống)'}`)
  }
  const launcher = findVsCodeLauncher(deps.env ?? process.env, exists)
  if (!launcher) {
    throw new Error('Không tìm thấy VS Code (Code.exe). Hãy cài VS Code hoặc đặt biến môi trường AICT_VSCODE_PATH.')
  }
  const spawnFn = deps.spawnFn ?? ((file, args, options) => spawn(file, args, options))
  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(launcher, [targetPath], { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    child.once('error', (err) => reject(new Error(`Không khởi chạy được VS Code: ${err.message}`)))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
