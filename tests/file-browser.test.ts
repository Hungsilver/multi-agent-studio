import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listWorkspaceDirectory,
  readExternalPreviewFile,
  readWorkspaceFile,
  writeWorkspaceFile
} from '../src/main/context/file-browser-service'

describe('Workspace File Browser Service', () => {
  let rootDir: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-fb-'))
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true })
    fs.mkdirSync(path.join(rootDir, 'node_modules', 'pkg'), { recursive: true })
    fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true })
    fs.writeFileSync(path.join(rootDir, 'README.md'), '# Hello\n', 'utf8')
    fs.writeFileSync(path.join(rootDir, 'src', 'app.ts'), 'export const x = 1\n', 'utf8')
    fs.writeFileSync(path.join(rootDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}', 'utf8')
    fs.writeFileSync(path.join(rootDir, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]))
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })

  it('lists directories first and ignores node_modules/.git', () => {
    const entries = listWorkspaceDirectory(rootDir)
    const names = entries.map((e) => e.name)
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(entries[0]).toMatchObject({ name: 'src', isDir: true, relPath: 'src' })
    expect(names).toContain('README.md')
  })

  it('reads and writes UTF-8 files safely inside workspace', () => {
    const read1 = readWorkspaceFile(rootDir, 'src/app.ts')
    expect(read1.isBinary).toBe(false)
    expect(read1.content).toContain('export const x = 1')

    writeWorkspaceFile(rootDir, 'src/new-file.ts', 'export const y = 2\n')
    const read2 = readWorkspaceFile(rootDir, 'src/new-file.ts')
    expect(read2.content).toBe('export const y = 2\n')
  })

  it('detects binary files and blocks path traversal outside rootDir', () => {
    const bin = readWorkspaceFile(rootDir, 'logo.bin')
    expect(bin.isBinary).toBe(true)
    expect(bin.content).toBe('')

    expect(() => listWorkspaceDirectory(rootDir, '../')).toThrow()
    expect(() => readWorkspaceFile(rootDir, '../../etc/passwd')).toThrow()
    expect(() => writeWorkspaceFile(rootDir, '../outside.txt', 'oops')).toThrow()
  })

  it('reads allowed external preview files such as plan markdown and blocks unsupported binaries', () => {
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-ext-'))
    try {
      const mdPath = path.join(extDir, 'implementation-plan.md')
      const exePath = path.join(extDir, 'evil.exe')
      fs.writeFileSync(mdPath, '# Plan\n- Step 1\n', 'utf8')
      fs.writeFileSync(exePath, 'MZ', 'utf8')

      const res = readExternalPreviewFile(`file:///${mdPath.replace(/\\/g, '/')}`)
      expect(res.content).toContain('# Plan')
      expect(res.isBinary).toBe(false)

      expect(() => readExternalPreviewFile(exePath)).toThrow()
    } finally {
      fs.rmSync(extDir, { recursive: true, force: true })
    }
  })
})
