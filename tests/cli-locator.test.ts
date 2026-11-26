import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findCodexEntryInDir,
  readCodexCachedModels,
  readCodexConfigDefaultModel,
  resolveCliCommand,
  resolveEffectiveCodexModel
} from '../src/main/ai/cli-locator'
import {
  buildEnrichedPath,
  isTransientFnmMultishell,
  resolveFnmInstallationDirs
} from '../src/main/system/env-resolver'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!
    fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('env-resolver & cli-locator', () => {
  it('filters transient fnm_multishells paths', () => {
    expect(isTransientFnmMultishell('C:\\Users\\Admin\\AppData\\Local\\fnm_multishells\\1234_999')).toBe(true)
    expect(isTransientFnmMultishell('C:\\Users\\Admin\\AppData\\Roaming\\fnm\\aliases\\default')).toBe(false)

    const enriched = buildEnrichedPath({
      PATH: 'C:\\Users\\Admin\\AppData\\Local\\fnm_multishells\\999_111;C:\\Windows\\System32'
    })
    expect(enriched.toLowerCase()).not.toContain('fnm_multishells')
    expect(enriched.toLowerCase()).toContain('system32')
  })

  it('resolves fnm installation directories and codex direct node entry', () => {
    const fnmDir = makeTempDir('fnm-test-')
    const instDir = path.join(fnmDir, 'node-versions', 'v26.13.0', 'installation')
    const codexBin = path.join(instDir, 'node_modules', '@openai', 'codex', 'bin')
    fs.mkdirSync(codexBin, { recursive: true })
    fs.writeFileSync(path.join(instDir, 'node.exe'), '')
    fs.writeFileSync(path.join(codexBin, 'codex.js'), '// codex entry')

    const res = resolveFnmInstallationDirs({ FNM_DIR: fnmDir })
    expect(res.allNodeDirs).toContain(instDir)

    const entry = findCodexEntryInDir(instDir)
    expect(entry).not.toBeNull()
    expect(entry?.nodeExe).toBe(path.join(instDir, 'node.exe'))
    expect(entry?.codexJs).toBe(path.join(codexBin, 'codex.js'))
  })

  it('reads codex default model and filters visibility=list models with smart fallback', () => {
    const codexHome = makeTempDir('codex-home-')
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.2-sol"\nmodel_reasoning_effort = "low"\n')
    fs.writeFileSync(
      path.join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'hidden-internal', visibility: 'hide', priority: 1 },
          { slug: 'gpt-5.6-terra', visibility: 'list', priority: 3 },
          { slug: 'gpt-6-luna', visibility: 'list', priority: 2 }
        ]
      })
    )
    expect(readCodexConfigDefaultModel(codexHome)).toBe('gpt-6.2-sol')
    expect(readCodexCachedModels(codexHome)).toEqual(['gpt-6-luna', 'gpt-5.6-terra'])

    const resolved = resolveEffectiveCodexModel('', codexHome)
    expect(resolved.model).toBe('gpt-6-luna')
    expect(resolved.fallbackReason).toContain('gpt-6-luna')
  })

  it('supports override path for agy.exe and js entrypoints', () => {
    const dir = makeTempDir('cli-override-')
    const agyExe = path.join(dir, 'agy.exe')
    fs.writeFileSync(agyExe, '')
    const resolved = resolveCliCommand('agy', agyExe)
    expect(resolved?.file).toBe(agyExe)
    expect(resolved?.resolvedVia).toBe('override')
  })
})
