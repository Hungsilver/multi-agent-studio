import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteSkillFile,
  listAllSkills,
  listRuleFiles,
  saveRuleFileContent,
  saveSkillFile,
  syncAgentsRuleToTargets
} from '../src/main/ai/governance-service'

const tempDirs: string[] = []

function makeWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-ws-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Governance: Skills & AGENTS.md', () => {
  it('creates, lists, and deletes workspace SKILL.md with YAML frontmatter', () => {
    const ws = makeWs()
    const saved = saveSkillFile({
      workspacePath: ws,
      scope: 'workspace',
      source: 'agents',
      name: 'dotnet-clean-arch',
      description: 'Quy ước Clean Architecture',
      tags: ['dotnet', 'architecture'],
      body: '## Quy tắc\n- Tách Domain và Application'
    })

    expect(fs.existsSync(saved.filePath)).toBe(true)
    const listed = listAllSkills(ws).filter((s) => s.scope === 'workspace')
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('dotnet-clean-arch')
    expect(listed[0].tags).toEqual(['dotnet', 'architecture'])

    deleteSkillFile(saved.filePath)
    expect(fs.existsSync(saved.filePath)).toBe(false)
  })

  it('saves AGENTS.md and syncs to CLAUDE.md and GEMINI.md', () => {
    const ws = makeWs()
    const agentsPath = path.join(ws, 'AGENTS.md')
    saveRuleFileContent(agentsPath, '# AGENTS\n- Always run tests')

    const synced = syncAgentsRuleToTargets(ws, ['CLAUDE.md', 'GEMINI.md'])
    expect(synced).toHaveLength(2)
    expect(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8')).toContain('Always run tests')
    expect(fs.readFileSync(path.join(ws, 'GEMINI.md'), 'utf8')).toContain('Always run tests')

    const rules = listRuleFiles(ws).filter((r) => r.scope === 'workspace')
    expect(rules.find((r) => r.name === 'AGENTS.md')?.exists).toBe(true)
  })
})
