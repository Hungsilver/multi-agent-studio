import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppsManager } from '../src/main/apps/apps-manager'
import { testAppHttpHealth } from '../src/main/apps/process-inspector'
import {
  addManualApp,
  cleanupOldAppLogs,
  exportAppsCatalogToFile,
  getAppsLogDir,
  importAppsCatalogFromFile,
  readAppsConfig,
  removeAppsFromCatalog,
  removeAppsProfile,
  resolveImportedDir,
  restoreAppsFromRemoved,
  saveAppsProfile,
  setAppsAutoRestart,
  updateAppConfig,
  writeAppsConfig
} from '../src/main/apps/apps-store'
import {
  buildIisSiteCommands,
  invokeIisAdmin,
  parseAppcmdSiteList,
  parseApplicationHostXml
} from '../src/main/apps/iis-service'
import { deriveGroupName, scanAndUpdateAppsCatalog } from '../src/main/apps/project-scanner'

const tempDirs: string[] = []
const managers: AppsManager[] = []

function makeTempDir(prefix = 'apps-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

async function pollUntil<T>(fn: () => Promise<T>, pred: (val: T) => boolean, timeoutMs = 15000, stepMs = 300): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last = await fn()
  while (!pred(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil timeout after ${timeoutMs}ms; last=${JSON.stringify(last)}`)
    }
    await new Promise((r) => setTimeout(r, stepMs))
    last = await fn()
  }
  return last
}

afterEach(async () => {
  for (const mgr of managers.splice(0)) {
    mgr.stopAllTunnels()
    try {
      const list = await mgr.listDevApps(false)
      for (const app of list) {
        if (app.known && !app.iis) {
          await mgr.stopDevApp(app.id).catch(() => {})
        }
      }
    } catch {
      // ignore cleanup error
    }
  }
  await new Promise((r) => setTimeout(r, 150))
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      await new Promise((r) => setTimeout(r, 300))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('apps module backend', () => {
  it('scans .NET Web/BFF/Tool and Vite projects while skipping tests and node_modules', () => {
    const dataDir = makeTempDir('apps-data-')
    const rootDir = makeTempDir('apps-scan-')

    // .NET 8 Web Backend
    const apiDir = path.join(rootDir, 'Demo.Projects', 'Demo.Api')
    fs.mkdirSync(path.join(apiDir, 'Properties'), { recursive: true })
    fs.writeFileSync(
      path.join(apiDir, 'Demo.Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    )
    fs.writeFileSync(
      path.join(apiDir, 'Properties', 'launchSettings.json'),
      JSON.stringify({
        profiles: {
          https: { commandName: 'Project', applicationUrl: 'https://localhost:7155;http://localhost:5155' }
        }
      })
    )

    // .NET 8 BFF
    const bffDir = path.join(rootDir, 'Demo.Projects', 'Demo.Bff')
    fs.mkdirSync(path.join(bffDir, 'Properties'), { recursive: true })
    fs.writeFileSync(
      path.join(bffDir, 'Demo.Bff.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    )
    fs.writeFileSync(
      path.join(bffDir, 'Properties', 'launchSettings.json'),
      JSON.stringify({
        profiles: {
          http: { commandName: 'Project', applicationUrl: 'http://localhost:5255' }
        }
      })
    )

    // .NET Console Tool
    const toolDir = path.join(rootDir, 'Demo.Projects', 'Demo.WorkerTool')
    fs.mkdirSync(toolDir, { recursive: true })
    fs.writeFileSync(
      path.join(toolDir, 'Demo.WorkerTool.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    )

    // .NET xUnit Test (must skip)
    const testProjDir = path.join(rootDir, 'Demo.Projects', 'Demo.Tests')
    fs.mkdirSync(testProjDir, { recursive: true })
    fs.writeFileSync(
      path.join(testProjDir, 'Demo.Tests.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsPackable>false</IsPackable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" /><PackageReference Include="xunit" Version="2.6.0" /></ItemGroup></Project>'
    )

    // Vite React Frontend with https + custom port
    const webDir = path.join(rootDir, 'Demo.Projects', 'demo-web')
    fs.mkdirSync(path.join(webDir, 'node_modules', 'fake-pkg'), { recursive: true })
    fs.writeFileSync(
      path.join(webDir, 'package.json'),
      JSON.stringify({ name: 'demo-web', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } })
    )
    fs.writeFileSync(
      path.join(webDir, 'vite.config.ts'),
      'export default { server: { port: 4173, https: true } }\n'
    )
    // Ignored nested vite project inside node_modules
    fs.writeFileSync(
      path.join(webDir, 'node_modules', 'fake-pkg', 'package.json'),
      JSON.stringify({ name: 'fake-pkg', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } })
    )

    expect(deriveGroupName(rootDir, apiDir)).toBe('DEMO')

    const res = scanAndUpdateAppsCatalog([rootDir], dataDir)
    expect(res.scannedCount).toBe(4)
    expect(res.totalCount).toBe(4)

    const byName = new Map(res.config.apps.map((a) => [a.name, a]))
    expect(byName.get('Demo.Api')?.type).toBe('backend')
    expect(byName.get('Demo.Api')?.port).toBe(7155)
    expect(byName.get('Demo.Bff')?.type).toBe('bff')
    expect(byName.get('Demo.Bff')?.port).toBe(5255)
    expect(byName.get('Demo.WorkerTool')?.type).toBe('tool')
    expect(byName.get('demo-web')?.type).toBe('frontend')
    expect(byName.get('demo-web')?.port).toBe(4173)
    expect(byName.get('demo-web')?.url).toBe('https://localhost:4173')
    expect(byName.has('Demo.Tests')).toBe(false)
    expect(byName.has('fake-pkg')).toBe(false)

    // Removing an app suppresses it on rescan until restored
    const webId = byName.get('demo-web')!.id
    removeAppsFromCatalog([webId], dataDir)
    const rescan = scanAndUpdateAppsCatalog([rootDir], dataDir)
    expect(rescan.scannedCount).toBe(3)
    expect(rescan.config.removed.some((r) => r.id === webId)).toBe(true)

    const restored = restoreAppsFromRemoved([webId], dataDir)
    expect(restored.restoredCount).toBe(1)
    expect(restored.config.apps.some((a) => a.id === webId)).toBe(true)
  })

  it('supports manual CRUD, profiles, auto-restart, catalog export/import, and daily log cleanup', () => {
    const dataDir = makeTempDir('apps-crud-')
    const localRoot = makeTempDir('apps-local-root-')
    const mappedProjDir = path.join(localRoot, 'Team.Projects', 'team-api')
    fs.mkdirSync(mappedProjDir, { recursive: true })

    // Manual add + update + autoRestart
    const created = addManualApp(
      {
        group: 'CORE',
        name: 'Manual Service',
        type: 'backend',
        port: 5511,
        url: 'http://localhost:5511',
        dir: localRoot,
        start: 'node server.js'
      },
      dataDir
    )
    expect(created.manual).toBe(true)
    const updated = updateAppConfig(created.id, { port: 5512, url: 'http://localhost:5512' }, dataDir)
    expect(updated.port).toBe(5512)

    const afterRestartFlag = setAppsAutoRestart([created.id], true, dataDir)
    expect(afterRestartFlag.apps[0].autoRestart).toBe(true)

    const withProfile = saveAppsProfile('Core Stack', [created.id], dataDir)
    expect(withProfile.profiles).toEqual([{ name: 'Core Stack', ids: [created.id] }])
    const withoutProfile = removeAppsProfile('Core Stack', dataDir)
    expect(withoutProfile.profiles).toHaveLength(0)

    // Export catalog (strips machine-specific autoRestart)
    saveAppsProfile('Shareable Stack', [created.id], dataDir)
    const exportFile = path.join(dataDir, 'team-export.json')
    const exported = exportAppsCatalogToFile(exportFile, dataDir)
    expect(exported.appCount).toBe(1)
    expect(exported.profileCount).toBe(1)

    // Import into second workspace with translated scanRoot path
    const secondDataDir = makeTempDir('apps-import-')
    writeAppsConfig(
      {
        scanRanges: [[5000, 5099]],
        scanRoots: [localRoot],
        apps: [],
        removed: [],
        profiles: [],
        showStats: false
      },
      secondDataDir
    )

    const foreignExport = path.join(secondDataDir, 'foreign.json')
    fs.writeFileSync(
      foreignExport,
      JSON.stringify({
        scanRoots: ['C:\\OldDevRoot'],
        apps: [
          {
            id: 'team-api',
            group: 'TEAM',
            name: 'Team API',
            type: 'backend',
            port: 5599,
            url: 'http://localhost:5599',
            dir: 'C:\\OldDevRoot\\Team.Projects\\team-api',
            start: 'dotnet run'
          }
        ],
        profiles: [{ name: 'Backend Set', ids: ['team-api'] }]
      })
    )
    expect(resolveImportedDir('C:\\OldDevRoot\\Team.Projects\\team-api', ['C:\\OldDevRoot'], [localRoot])).toBe(
      mappedProjDir
    )

    const imp = importAppsCatalogFromFile(foreignExport, secondDataDir)
    expect(imp.addedApps).toBe(1)
    expect(imp.addedProfiles).toBe(1)
    expect(imp.missingDirs).toBe(0)
    expect(imp.config.apps[0].dir).toBe(mappedProjDir)

    // Daily log cleanup: trims files >1 day old down to last 200 lines
    const logDir = getAppsLogDir(secondDataDir)
    fs.mkdirSync(logDir, { recursive: true })
    const oldLogPath = path.join(logDir, 'old-service.log')
    const lines = Array.from({ length: 350 }, (_, i) => `line-${i + 1}`)
    fs.writeFileSync(oldLogPath, lines.join('\n') + '\n', 'utf8')
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000)
    fs.utimesSync(oldLogPath, twoDaysAgo, twoDaysAgo)

    const trimmedCount = cleanupOldAppLogs(secondDataDir)
    expect(trimmedCount).toBe(1)
    const remainingText = fs.readFileSync(oldLogPath, 'utf8')
    const remaining = remainingText.split('\n')
    expect(remaining[0]).toContain('giữ 200 dòng cuối')
    expect(remaining.length).toBeLessThanOrEqual(202)
    expect(remainingText).not.toContain('line-100\n')
    expect(remainingText).toContain('line-350')
    expect(readAppsConfig(secondDataDir).apps.length).toBeGreaterThanOrEqual(1)
  })

  it('parses IIS applicationHost.config XML cleanly', () => {
    const sampleXml = `
      <configuration>
        <system.applicationHost>
          <sites>
            <site name="Demo.Portal" id="12">
              <application path="/" applicationPool="DemoPool">
                <virtualDirectory path="/" physicalPath="%SystemDrive%\\inetpub\\demo-portal" />
              </application>
              <bindings>
                <binding protocol="http" bindingInformation="*:8081:localhost" />
                <binding protocol="https" bindingInformation="*:8443:localhost" />
              </bindings>
            </site>
          </sites>
        </system.applicationHost>
      </configuration>
    `
    const sites = parseApplicationHostXml(sampleXml)
    expect(sites).toHaveLength(1)
    expect(sites[0].name).toBe('Demo.Portal')
    expect(sites[0].pool).toBe('DemoPool')
    expect(sites[0].port).toBe(8443)
    expect(sites[0].url).toBe('https://localhost:8443')
    expect(sites[0].bindings).toHaveLength(2)
    expect(sites[0].physicalPath.toLowerCase()).toContain('inetpub\\demo-portal')
  })

  it('starts a real Node HTTP app, inspects PID/RAM/HTTP 200 health, reads live log, and stops cleanly', async () => {
    const dataDir = makeTempDir('apps-mgr-data-')
    const appDir = makeTempDir('apps-node-srv-')
    const port = await getFreePort()

    fs.writeFileSync(
      path.join(appDir, 'server.js'),
      [
        "const http = require('node:http');",
        `const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); });`,
        `srv.listen(${port}, '127.0.0.1', () => { console.log('NODE_APP_READY:' + ${port}); });`,
        "setInterval(() => {}, 1000);"
      ].join('\n'),
      'utf8'
    )

    const app = addManualApp(
      {
        id: 'node-test-server',
        group: 'E2E',
        name: 'Node Test Server',
        type: 'backend',
        port,
        url: `http://127.0.0.1:${port}`,
        dir: appDir,
        start: 'node server.js'
      },
      dataDir
    )

    const manager = new AppsManager(dataDir)
    managers.push(manager)

    const startMsg = await manager.startDevApp(app.id)
    expect(startMsg).toContain('Node Test Server')
    expect(startMsg).toContain(String(port))

    const runningRows = await pollUntil(
      () => manager.listDevApps(true),
      (rows) => {
        const hit = rows.find((r) => r.id === app.id)
        return Boolean(hit && hit.running && hit.healthOk === true && hit.healthCode === 200 && (hit.ramMb ?? 0) > 0)
      },
      15000,
      350
    )

    const row = runningRows.find((r) => r.id === app.id)!
    expect(row.pid).toBeGreaterThan(0)
    expect(row.healthCode).toBe(200)
    expect(row.ramMb).toBeGreaterThan(0)

    const log = await manager.getAppLog(app.id, 100)
    expect(log).toContain(`NODE_APP_READY:${port}`)

    const share = manager.getShareInfo(row.name, row.group, port, row.url)
    expect(share.lanUrl).toContain(`:${port}`)

    await manager.stopDevApp(app.id)
    const stoppedRows = await pollUntil(
      () => manager.listDevApps(false),
      (rows) => {
        const hit = rows.find((r) => r.id === app.id)
        return Boolean(hit && !hit.running)
      },
      10000,
      300
    )
    expect(stoppedRows.find((r) => r.id === app.id)?.running).toBe(false)
  }, 25000)

  it('handles .NET Worker fallback, spaced launch profile, Vite comment/preview stripping, overlapping roots, and manual override preservation', () => {
    const dataDir = makeTempDir('apps-scan-edge-data-')
    const outerRoot = makeTempDir('apps-scan-edge-root-')
    const nestedRoot = path.join(outerRoot, 'Edge.Projects')
    fs.mkdirSync(nestedRoot, { recursive: true })

    // Worker service without launchSettings -> discovered as tool
    const workerDir = path.join(nestedRoot, 'Edge.Worker')
    fs.mkdirSync(workerDir, { recursive: true })
    fs.writeFileSync(
      path.join(workerDir, 'Edge.Worker.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Worker"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    )

    // .NET Web with spaced profile name
    const webApiDir = path.join(nestedRoot, 'Edge.Api')
    fs.mkdirSync(path.join(webApiDir, 'Properties'), { recursive: true })
    fs.writeFileSync(
      path.join(webApiDir, 'Edge.Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    )
    fs.writeFileSync(
      path.join(webApiDir, 'Properties', 'launchSettings.json'),
      JSON.stringify({
        profiles: {
          'Dev HTTPS Profile': { commandName: 'Project', applicationUrl: 'https://localhost:7301' }
        }
      })
    )

    // Vite config with commented port and preview block
    const viteDir = path.join(nestedRoot, 'edge-vite')
    fs.mkdirSync(viteDir, { recursive: true })
    fs.writeFileSync(
      path.join(viteDir, 'package.json'),
      JSON.stringify({ name: 'edge-vite', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } })
    )
    const viteCfgPath = path.join(viteDir, 'vite.config.ts')
    fs.writeFileSync(
      viteCfgPath,
      [
        '// port: 3000',
        'export default {',
        '  /* port: 9999 */',
        '  preview: { port: 4173 },',
        '  server: { port: 5199 }',
        '}'
      ].join('\n')
    )

    const res1 = scanAndUpdateAppsCatalog([outerRoot, nestedRoot], dataDir)
    expect(res1.scannedCount).toBe(3)
    const byName1 = new Map(res1.config.apps.map((a) => [a.name, a]))
    expect(byName1.get('Edge.Worker')?.type).toBe('tool')
    expect(byName1.get('Edge.Api')?.start).toBe('dotnet run --launch-profile "Dev HTTPS Profile"')
    expect(byName1.get('edge-vite')?.port).toBe(5199)

    // Mark Edge.Api manual and customize its port, while changing edge-vite port in vite.config.ts
    updateAppConfig(byName1.get('Edge.Api')!.id, { port: 7999, manual: true }, dataDir)
    fs.writeFileSync(viteCfgPath, 'export default { server: { port: 5299, https: true } }')

    const res2 = scanAndUpdateAppsCatalog([outerRoot], dataDir)
    const byName2 = new Map(res2.config.apps.map((a) => [a.name, a]))
    expect(byName2.get('Edge.Api')?.port).toBe(7999)
    expect(byName2.get('edge-vite')?.port).toBe(5299)
    expect(byName2.get('edge-vite')?.url).toBe('https://localhost:5299')
  })

  it('validates empty start, tail-reads >300KB logs, truncates logs, and probes IPv6 ::1 health', async () => {
    const dataDir = makeTempDir('apps-hardening-data-')
    const appDir = makeTempDir('apps-hardening-app-')
    const manager = new AppsManager(dataDir)
    managers.push(manager)

    const emptyStartApp = addManualApp(
      {
        id: 'empty-start-app',
        group: 'EDGE',
        name: 'No Start Cmd',
        type: 'backend',
        port: 5900,
        url: 'http://localhost:5900',
        dir: appDir,
        start: '   '
      },
      dataDir
    )
    await expect(manager.startDevApp(emptyStartApp.id)).rejects.toThrow(/chưa có lệnh Start/)

    // Bounded >300KB log tail read
    const logDir = getAppsLogDir(dataDir)
    fs.mkdirSync(logDir, { recursive: true })
    const bigLogPath = path.join(logDir, `${emptyStartApp.id}.log`)
    const prefixChunk = 'OLD_LOG_LINE_PADDING_0123456789\n'.repeat(11000) // ~352 KB
    fs.writeFileSync(bigLogPath, `${prefixChunk}RECENT_TAIL_MARKER\n`, 'utf8')
    const tail = await manager.getAppLog(emptyStartApp.id, 50)
    expect(tail).toContain('RECENT_TAIL_MARKER')
    expect(tail.length).toBeLessThan(10000)

    manager.clearAppLog(emptyStartApp.id)
    expect(fs.readFileSync(bigLogPath, 'utf8')).toBe('')

    // IPv6 ::1-only probe check (gracefully skipped if host disables IPv6 loopback)
    const srv6 = http.createServer((_req, res) => {
      res.writeHead(200)
      res.end('v6')
    })
    let port6 = 0
    try {
      port6 = await new Promise<number>((resolve, reject) => {
        srv6.once('error', reject)
        srv6.listen(0, '::1', () => {
          const addr = srv6.address()
          resolve(typeof addr === 'object' && addr ? addr.port : 0)
        })
      })
    } catch {
      port6 = 0
    }
    try {
      if (port6 > 0) {
        const health = await testAppHttpHealth(`http://localhost:${port6}`, port6, 2500)
        expect(health.ok).toBe(true)
        expect(health.code).toBe(200)
      }
    } finally {
      await new Promise<void>((r) => (srv6.listening ? srv6.close(() => r()) : r()))
    }
  })

  it('detects unexpected exit and emits auto-restart alert + restarts crashed app', async () => {
    const dataDir = makeTempDir('apps-crash-data-')
    const appDir = makeTempDir('apps-crash-srv-')
    const port = await getFreePort()
    const flagFile = path.join(appDir, 'crashed-once.flag')

    fs.writeFileSync(
      path.join(appDir, 'crash-srv.js'),
      [
        "const fs = require('node:fs');",
        "const http = require('node:http');",
        `const flag = ${JSON.stringify(flagFile)};`,
        "const firstBoot = !fs.existsSync(flag);",
        "const srv = http.createServer((req, res) => {",
        "  res.writeHead(200);",
        "  res.end('ok');",
        "  if (firstBoot && req.url === '/crash') {",
        "    fs.writeFileSync(flag, '1');",
        "    setTimeout(() => process.exit(1), 40);",
        "  }",
        "});",
        `srv.listen(${port}, '127.0.0.1', () => {`,
        "  console.log(firstBoot ? 'FIRST_BOOT' : 'RESTARTED_BOOT');",
        "});"
      ].join('\n'),
      'utf8'
    )

    const app = addManualApp(
      {
        id: 'crash-auto-app',
        group: 'CRASH',
        name: 'Crash Auto App',
        type: 'backend',
        port,
        url: `http://127.0.0.1:${port}`,
        dir: appDir,
        start: 'node crash-srv.js',
        autoRestart: true
      },
      dataDir
    )

    const manager = new AppsManager(dataDir)
    managers.push(manager)
    const alerts: Array<{ kind: string; title: string; message: string }> = []
    manager.on('apps:alert', (a) => alerts.push(a))

    await manager.startDevApp(app.id)

    // 1. Wait deterministically until first boot is observed running
    await pollUntil(
      () => manager.listDevApps(false),
      (rows) => Boolean(rows.find((r) => r.id === app.id && r.running)),
      12000,
      250
    )

    // 2. Crash the server via HTTP and poll until watcher observes down & triggers auto-restart
    await fetch(`http://127.0.0.1:${port}/crash`)
    await new Promise((r) => setTimeout(r, 300))

    await pollUntil(
      () => manager.listDevApps(false),
      (rows) => alerts.some((a) => a.kind === 'auto-restart') && Boolean(rows.find((r) => r.id === app.id && r.running)),
      18000,
      350
    )

    expect(alerts.some((a) => a.kind === 'auto-restart')).toBe(true)
    const log = await manager.getAppLog(app.id, 100)
    expect(log).toContain('RESTARTED_BOOT')

    await manager.stopDevApp(app.id)
  }, 30000)

  it('P1.1: verifies process identity, skips foreign port owners and recycled PIDs, and stops only target sibling in shared dir', async () => {
    const dataDir = makeTempDir('apps-p11-data-')
    const appDirA = makeTempDir('apps-p11-a-')
    const appDirShared = makeTempDir('apps-p11-shared-')
    const logDir = getAppsLogDir(dataDir)
    fs.mkdirSync(logDir, { recursive: true })

    addManualApp(
      {
        id: 'app-a',
        group: 'P1',
        name: 'App A',
        type: 'backend',
        port: 5401,
        url: 'http://localhost:5401',
        dir: appDirA,
        start: 'node api.js'
      },
      dataDir
    )
    addManualApp(
      {
        id: 'shared-1',
        group: 'P1',
        name: 'Shared One',
        type: 'backend',
        port: 5402,
        url: 'http://localhost:5402',
        dir: appDirShared,
        start: 'node worker-one.js'
      },
      dataDir
    )
    addManualApp(
      {
        id: 'shared-2',
        group: 'P1',
        name: 'Shared Two',
        type: 'backend',
        port: 5403,
        url: 'http://localhost:5403',
        dir: appDirShared,
        start: 'node worker-two.js'
      },
      dataDir
    )

    // Stale PID file whose PID (9001) was recycled to unrelated process with a brand new CreationDateMs
    fs.writeFileSync(
      path.join(logDir, 'app-a.pid'),
      JSON.stringify({ pid: 9001, createdAtMs: 1000, processCreationMs: 1000, appId: 'app-a', dir: appDirA, start: 'node api.js' })
    )
    fs.writeFileSync(
      path.join(logDir, 'shared-1.pid'),
      JSON.stringify({ pid: 9101, createdAtMs: 2000, processCreationMs: 2000, appId: 'shared-1', dir: appDirShared, start: 'node worker-one.js' })
    )
    fs.writeFileSync(
      path.join(logDir, 'shared-2.pid'),
      JSON.stringify({ pid: 9201, createdAtMs: 2000, processCreationMs: 2000, appId: 'shared-2', dir: appDirShared, start: 'node worker-two.js' })
    )

    const killedPids: number[] = []
    const mgr = new AppsManager(dataDir, {
      getListeningPorts: async () => [
        { localPort: 5401, owningProcess: 8888 }, // unrelated process holding App A's port
        { localPort: 5402, owningProcess: 9102 },
        { localPort: 5403, owningProcess: 9202 }
      ],
      getWindowsProcesses: async () => [
        {
          ProcessId: 8888,
          ParentProcessId: 100,
          Name: 'python.exe',
          ExecutablePath: 'C:\\Python312\\python.exe',
          CommandLine: 'python -m http.server 5401',
          CreationDateMs: 5000
        },
        {
          ProcessId: 9001,
          ParentProcessId: 100,
          Name: 'notepad.exe',
          ExecutablePath: 'C:\\Windows\\System32\\notepad.exe',
          CommandLine: 'notepad.exe',
          CreationDateMs: 999999 // mismatched CreationDateMs => recycled PID!
        },
        {
          ProcessId: 9101,
          ParentProcessId: 100,
          Name: 'cmd.exe',
          CommandLine: 'cmd.exe /c node worker-one.js',
          CreationDateMs: 2000
        },
        {
          ProcessId: 9102,
          ParentProcessId: 9101,
          Name: 'node.exe',
          CommandLine: `node "${path.join(appDirShared, 'worker-one.js')}"`,
          CreationDateMs: 2010
        },
        {
          ProcessId: 9201,
          ParentProcessId: 100,
          Name: 'cmd.exe',
          CommandLine: 'cmd.exe /c node worker-two.js',
          CreationDateMs: 2000
        },
        {
          ProcessId: 9202,
          ParentProcessId: 9201,
          Name: 'node.exe',
          CommandLine: `node "${path.join(appDirShared, 'worker-two.js')}"`,
          CreationDateMs: 2010
        }
      ],
      killProcessTree: async (pid) => {
        killedPids.push(pid)
      }
    })
    managers.push(mgr)

    const list = await mgr.listDevApps(false)
    const rowA = list.find((r) => r.id === 'app-a')!
    expect(rowA.running).toBe(false)
    expect(rowA.busy).toBe(true)
    expect(rowA.busyPid).toBe(8888)
    expect(list.find((r) => r.id === 'shared-1')?.running).toBe(true)
    expect(list.find((r) => r.id === 'shared-2')?.running).toBe(true)

    // Stopping app-a refuses to kill foreign PID 8888 OR recycled PID 9001, and cleans stale .pid
    await expect(mgr.stopDevApp('app-a')).rejects.toThrow(/Giải phóng port/)
    expect(killedPids).toEqual([])
    expect(fs.existsSync(path.join(logDir, 'app-a.pid'))).toBe(false)

    // Stopping shared-1 kills ONLY shared-1 PIDs (9101 root, and/or 9102 child), NEVER 9201/9202
    killedPids.length = 0
    await mgr.stopDevApp('shared-1')
    expect(killedPids.some((p) => p === 9101 || p === 9102)).toBe(true)
    expect(killedPids).not.toContain(9201)
    expect(killedPids).not.toContain(9202)
  })

  it('P1.2: limits IIS Start/Stop/Restart to selected site without stopping/recycling shared pool and surfaces appcmd & UAC errors', async () => {
    const sites = [
      {
        name: 'SiteA',
        id: 1,
        pool: 'SharedPool',
        physicalPath: 'C:\\inetpub\\site-a',
        bindings: [{ protocol: 'http' as const, port: 8080, host: '' }],
        port: 8080,
        url: 'http://localhost:8080'
      },
      {
        name: 'SiteB',
        id: 2,
        pool: 'SharedPool',
        physicalPath: 'C:\\inetpub\\site-b',
        bindings: [{ protocol: 'http' as const, port: 8080, host: '' }],
        port: 8080,
        url: 'http://localhost:8080'
      }
    ]

    for (const action of ['start', 'stop', 'restart'] as const) {
      const cmds = buildIisSiteCommands([sites[0]], action)
      const joined = cmds.map((c) => c.args.join(' ')).join('\n')
      expect(joined).toContain('site')
      expect(joined).toContain('/site.name:SiteA')
      expect(joined).not.toMatch(/apppool|recycle|SiteB/i)
    }

    // appcmd failure inside elevated run writes diagnostic result JSON and surfaces exact message
    await expect(
      invokeIisAdmin(['SiteA'], 'stop', {
        getSites: () => sites,
        runElevated: async (_script, resultPath) => {
          fs.writeFileSync(
            resultPath,
            JSON.stringify({ ok: false, site: 'SiteA', exitCode: 5, output: 'ERROR ( message:Access denied )' })
          )
          return { exitCode: 5 }
        }
      })
    ).rejects.toThrow(/Lỗi IIS \(SiteA, mã 5\): ERROR \( message:Access denied \)/)

    // UAC cancellation returns dedicated UAC cancellation message
    await expect(
      invokeIisAdmin(['SiteA'], 'start', {
        getSites: () => sites,
        runElevated: async () => ({ exitCode: 1223, cancelled: true })
      })
    ).rejects.toThrow(/Đã hủy — thao tác IIS cần quyền Administrator/)
  })

  it('P1.3: keeps tunnel state & Stop action when kill fails and clears after retry or exited process', async () => {
    const dataDir = makeTempDir('apps-p13-data-')
    let shouldFailKill = true
    const killAttempts: number[] = []

    const mgr = new AppsManager(dataDir, {
      findDevTunnelExe: async () => 'devtunnel.exe',
      spawn: () => {
        const cp = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void }
        cp.pid = 7777
        cp.unref = () => {}
        setImmediate(() => cp.emit('spawn'))
        return cp as unknown as ChildProcess
      },
      killProcessTree: async (pid) => {
        killAttempts.push(pid)
        if (shouldFailKill) {
          throw new Error(`Không thể dừng tiến trình PID ${pid}: Access is denied`)
        }
      }
    })
    managers.push(mgr)

    addManualApp(
      {
        id: 'tunnel-app',
        group: 'TUN',
        name: 'Tunnel API',
        type: 'backend',
        port: 5555,
        url: 'http://localhost:5555',
        dir: dataDir,
        start: 'node srv.js'
      },
      dataDir
    )

    await mgr.startTunnel(5555, 'Tunnel API')
    let rows = await mgr.listDevApps(false)
    expect(rows[0].tunnelPending).toBe(true)

    // Failure preserves tunnel state so Stop remains available
    await expect(mgr.stopTunnel(5555)).rejects.toThrow(/Access is denied/)
    rows = await mgr.listDevApps(false)
    expect(rows[0].tunnelPending).toBe(true)

    // Retry succeeds -> tunnel removed
    shouldFailKill = false
    const okMsg = await mgr.stopTunnel(5555)
    expect(okMsg).toContain('Đã dừng public port 5555')
    rows = await mgr.listDevApps(false)
    expect(rows[0].tunnelPending).toBe(false)
    expect(rows[0].tunnelUrl).toBeNull()
    expect(killAttempts).toEqual([7777, 7777])

    // Calling stopTunnel when no active tunnel (e.g. process exited already) succeeds gracefully
    expect(await mgr.stopTunnel(5555)).toContain('không có tunnel')
  })

  it('P2.4: reports per-site IIS status accurately when two sites share a port and starts stopped site', async () => {
    const dataDir = makeTempDir('apps-p24-data-')
    const siteADir = makeTempDir('apps-p24-a-')
    const siteBDir = makeTempDir('apps-p24-b-')
    writeAppsConfig(
      {
        scanRanges: [[5000, 5099]],
        scanRoots: [],
        apps: [
          { id: 'iis-a', group: 'IIS', name: 'SiteA', iis: 'SiteA', type: 'backend', port: 8080, url: 'http://localhost:8080', dir: siteADir, start: '' },
          { id: 'iis-b', group: 'IIS', name: 'SiteB', iis: 'SiteB', type: 'backend', port: 8080, url: 'http://localhost:8080', dir: siteBDir, start: '' }
        ],
        removed: [],
        profiles: [],
        showStats: false
      },
      dataDir
    )

    const states = parseAppcmdSiteList(
      'SITE "SiteA" (id:1,bindings:http/*:8080:,state:Stopped)\nSITE "SiteB" (id:2,bindings:http/*:8080:,state:Started)'
    )
    expect(states.get('SiteA')).toBe('Stopped')
    expect(states.get('SiteB')).toBe('Started')

    const startedSites: string[] = []
    const mgr = new AppsManager(dataDir, {
      getListeningPorts: async () => [{ localPort: 8080, owningProcess: 4 }],
      getWindowsProcesses: async () => [{ ProcessId: 4, Name: 'System', CreationDateMs: 1 }],
      getIisSites: () => [
        { name: 'SiteA', id: 1, pool: 'SharedPool', physicalPath: siteADir, bindings: [], port: 8080, url: 'http://localhost:8080' },
        { name: 'SiteB', id: 2, pool: 'SharedPool', physicalPath: siteBDir, bindings: [], port: 8080, url: 'http://localhost:8080' }
      ],
      getIisSiteStates: async () => states,
      getIisWorkerPids: async () => new Map([['SharedPool', [4321]]]),
      invokeIisAdmin: async (names, action) => {
        if (action === 'start') startedSites.push(...names)
      }
    })
    managers.push(mgr)

    const rows = await mgr.listDevApps(false)
    expect(rows.find((r) => r.id === 'iis-a')?.running).toBe(false)
    expect(rows.find((r) => r.id === 'iis-a')?.pid).toBe(0)
    expect(rows.find((r) => r.id === 'iis-b')?.running).toBe(true)
    expect(rows.find((r) => r.id === 'iis-b')?.pid).toBe(4321)

    const startRes = await mgr.startDevApp('iis-a')
    expect(startRes).toContain('Đã khởi động site IIS SiteA')
    expect(startedSites).toEqual(['SiteA'])
  })

  it('P2.5 & P2.6: handles background/one-shot tools in startOrdered and catches async spawn ENOENT errors cleanly', async () => {
    const dataDir = makeTempDir('apps-p25-data-')
    const appDir = makeTempDir('apps-p25-app-')

    const bgTool = addManualApp(
      { id: 'bg-tool', group: 'T', name: 'BG Tool', type: 'tool', port: 0, url: '', dir: appDir, start: 'node bg.js' },
      dataDir
    )
    const okTool = addManualApp(
      { id: 'ok-tool', group: 'T', name: 'OneShot OK', type: 'tool', port: 0, url: '', dir: appDir, start: 'node ok.js' },
      dataDir
    )
    const failTool = addManualApp(
      { id: 'fail-tool', group: 'T', name: 'OneShot Fail', type: 'tool', port: 0, url: '', dir: appDir, start: 'node fail.js' },
      dataDir
    )
    const nextBe = addManualApp(
      { id: 'next-be', group: 'T', name: 'Next BE', type: 'backend', port: 5777, url: 'http://localhost:5777', dir: appDir, start: 'node be.js' },
      dataDir
    )

    let fakePid = 50000
    const alivePids = new Set<number>()
    let portBound = false
    const mgr = new AppsManager(dataDir, {
      toolReadyGraceMs: 80,
      orderedPollMs: 40,
      isPidAlive: async (pid) => alivePids.has(pid),
      getListeningPorts: async () => (portBound ? [{ localPort: 5777, owningProcess: 50099 }] : []),
      getWindowsProcesses: async () =>
        portBound ? [{ ProcessId: 50099, ParentProcessId: 1, Name: 'node.exe', CommandLine: `${appDir}\\be.js`, CreationDateMs: 5000 }] : [],
      spawn: (cmd) => {
        const cp = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void }
        cp.unref = () => {}
        if (String(cmd).includes('broken-bin')) {
          setImmediate(() => cp.emit('error', Object.assign(new Error('spawn broken ENOENT'), { code: 'ENOENT' })))
          return cp as unknown as ChildProcess
        }
        const pid = String(cmd).includes('be.js') ? 50099 : ++fakePid
        cp.pid = pid
        alivePids.add(pid)
        setImmediate(() => {
          cp.emit('spawn')
          if (String(cmd).includes('be.js')) {
            setTimeout(() => {
              portBound = true
            }, 30)
          } else if (String(cmd).includes('ok.js')) {
            setTimeout(() => {
              alivePids.delete(pid)
              cp.emit('exit', 0, null)
            }, 35)
          } else if (String(cmd).includes('fail.js')) {
            setTimeout(() => {
              alivePids.delete(pid)
              cp.emit('exit', 1, null)
            }, 35)
          }
        })
        return cp as unknown as ChildProcess
      }
    })
    managers.push(mgr)

    // P2.5 background tool + one-shot code 0 lets backend phase run without waiting forever
    const okBatch = await mgr.runBatchAction('startseq', [bgTool.id, okTool.id, nextBe.id], 5)
    expect(okBatch.ok).toBe(true)
    expect(okBatch.messages.some((m) => m.includes('đang chạy nền'))).toBe(true)
    expect(okBatch.messages.some((m) => m.includes('đã chạy xong'))).toBe(true)

    // P2.5 one-shot code 1 reports failure clearly
    const failBatch = await mgr.runBatchAction('startseq', [failTool.id], 5)
    expect(failBatch.ok).toBe(false)
    expect(failBatch.errors[0]).toContain('mã lỗi 1')

    // P2.6 spawn error rejects cleanly without throwing uncaught exception or leaving .pid
    const brokenApp = addManualApp(
      { id: 'broken-spawn', group: 'T', name: 'Broken Spawn', type: 'backend', port: 5778, url: '', dir: appDir, start: 'broken-bin' },
      dataDir
    )
    await expect(mgr.startDevApp(brokenApp.id)).rejects.toThrow(/ENOENT/)
    expect(fs.existsSync(path.join(getAppsLogDir(dataDir), 'broken-spawn.pid'))).toBe(false)
  })

  it('P2.7: reserves removed IDs during scan/add and preserves conflicted removed entries on restore', () => {
    const dataDir = makeTempDir('apps-p27-data-')
    const scanRoot = makeTempDir('apps-p27-root-')

    // Project 1 named "demo-api"
    const p1 = path.join(scanRoot, 'GroupA', 'demo-api')
    fs.mkdirSync(path.join(p1, 'Properties'), { recursive: true })
    fs.writeFileSync(path.join(p1, 'demo-api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
    fs.writeFileSync(path.join(p1, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { http: { commandName: 'Project', applicationUrl: 'http://localhost:5801' } } }))

    scanAndUpdateAppsCatalog([scanRoot], dataDir)
    saveAppsProfile('Keep Stack', ['demo-api'], dataDir)
    removeAppsFromCatalog(['demo-api'], dataDir)

    // Create another project in a different folder also named "demo-api"
    const p2 = path.join(scanRoot, 'GroupB', 'demo-api')
    fs.mkdirSync(path.join(p2, 'Properties'), { recursive: true })
    fs.writeFileSync(path.join(p2, 'demo-api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
    fs.writeFileSync(path.join(p2, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { http: { commandName: 'Project', applicationUrl: 'http://localhost:5802' } } }))

    const scanned = scanAndUpdateAppsCatalog([scanRoot], dataDir)
    const newProj = scanned.config.apps.find((a) => a.dir.toLowerCase() === p2.toLowerCase())!
    expect(newProj.id).toBe('demo-api-2')

    const restored = restoreAppsFromRemoved(['demo-api'], dataDir)
    expect(restored.restoredCount).toBe(1)
    expect(restored.conflicts).toEqual([])
    const restoredApp = restored.config.apps.find((a) => a.id === 'demo-api')!
    expect(restoredApp.dir.toLowerCase()).toBe(p1.toLowerCase())
    expect(restored.config.profiles[0].ids).toEqual(['demo-api'])

    // Pre-existing legacy catalog with duplicate ID in removed keeps conflicted entry in removed!
    const legacyConflictDir = makeTempDir('apps-p27-legacy-')
    writeAppsConfig(
      {
        scanRanges: [[5000, 5099]],
        scanRoots: [],
        apps: [{ id: 'dup-id', group: 'A', name: 'Active', type: 'backend', port: 5810, url: '', dir: 'C:\\a', start: 'node a.js' }],
        removed: [{ id: 'dup-id', group: 'B', name: 'Removed Dup', type: 'backend', port: 5811, url: '', dir: 'C:\\b', start: 'node b.js' }],
        profiles: [],
        showStats: false
      },
      legacyConflictDir
    )
    const conflictRes = restoreAppsFromRemoved(['dup-id'], legacyConflictDir)
    expect(conflictRes.restoredCount).toBe(0)
    expect(conflictRes.conflicts).toEqual([{ id: 'dup-id', name: 'Removed Dup' }])
    expect(conflictRes.config.removed).toHaveLength(1)
    expect(conflictRes.config.removed[0].id).toBe('dup-id')
  })
})
