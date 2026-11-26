import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDatabase } from '../src/main/storage/database'
import { importLegacyPegasusData } from '../src/main/storage/legacy-importer'
import { WorkspaceRepository } from '../src/main/storage/repositories'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Legacy PegasusPanel V1 Importer', () => {
  it('safely imports theme, workspaces, and AI sessions without modifying V1 files', async () => {
    const legacyDir = makeTempDir('legacy-v1-')
    const projectDir = makeTempDir('proj-a-')

    const rawConfig = JSON.stringify({
      theme: 'aurora',
      colorScheme: 'teal',
      aiClaudeAuth: 'account',
      aiDirs: [projectDir],
      aiSessions: [
        { Tool: 'claude', Id: 'cl-sess-1', Dir: projectDir, Title: 'Phiên V1 cũ', Updated: '2026-11-20T10:00:00' }
      ]
    })
    fs.writeFileSync(path.join(legacyDir, 'config.json'), rawConfig, 'utf8')

    const db = new WorkspaceDatabase(':memory:')
    await db.init()
    const repo = new WorkspaceRepository(db)

    const res = importLegacyPegasusData(repo, legacyDir)
    expect(res.found).toBe(true)
    expect(res.importedWorkspaces).toBe(1)
    expect(res.importedSessions).toBe(1)
    expect(res.theme).toBe('aurora')
    expect(res.accent).toBe('teal')
    expect(res.claudeAuthMode).toBe('account')

    const settings = repo.getSettings()
    expect(settings.theme).toBe('aurora')
    expect(settings.accent).toBe('teal')
    expect(settings.claudeAuthMode).toBe('account')

    // Original V1 file untouched
    expect(fs.readFileSync(path.join(legacyDir, 'config.json'), 'utf8')).toBe(rawConfig)
    db.close()
  })
})
