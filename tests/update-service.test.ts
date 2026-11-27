import { afterEach, describe, expect, it, vi } from 'vitest'

const appMock = { version: '1.0.0', packaged: true }

vi.mock('electron', () => ({
  app: {
    getVersion: () => appMock.version,
    get isPackaged() {
      return appMock.packaged
    },
    getAppPath: () => 'C:/nonexistent-app-root'
  }
}))

import { checkForAppUpdates, compareSemver } from '../src/main/system/update-service'

function mockFetch(impl: () => Promise<Partial<Response>>): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
  appMock.version = '1.0.0'
  appMock.packaged = true
})

describe('compareSemver', () => {
  it('so sánh đúng số, tiền tố v và bản tiền phát hành', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1)
    expect(compareSemver('v1.10.0', '1.9.9')).toBe(1)
    expect(compareSemver('1.0', '1.0.0')).toBe(0)
    expect(compareSemver('2.0.0', '10.0.0')).toBe(-1)
    expect(compareSemver('1.2.3-beta.1', '1.2.3')).toBe(0)
  })
})

describe('checkForAppUpdates (bản đóng gói, GitHub Releases)', () => {
  it('báo có bản mới khi tag lớn hơn', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v1.2.0', html_url: 'https://github.com/x/y/releases/tag/v1.2.0', body: 'ghi chú' })
    }))
    const r = await checkForAppUpdates()
    expect(r.status).toBe('update-available')
    expect(r.latestVersion).toBe('1.2.0')
    expect(r.currentVersion).toBe('1.0.0')
    expect(r.releaseUrl).toContain('/tag/v1.2.0')
    expect(r.releaseNotes).toBe('ghi chú')
  })

  it('báo đã mới nhất khi tag bằng hoặc nhỏ hơn bản đang chạy', async () => {
    appMock.version = '1.2.0'
    for (const tag of ['v1.2.0', 'v1.1.9']) {
      mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag }) }))
      expect((await checkForAppUpdates()).status).toBe('up-to-date')
    }
  })

  it('404/401/403 → private-or-unreachable; HTTP khác → error; mất mạng → error', async () => {
    for (const status of [404, 401, 403]) {
      mockFetch(async () => ({ ok: false, status }))
      expect((await checkForAppUpdates()).status).toBe('private-or-unreachable')
    }
    mockFetch(async () => ({ ok: false, status: 500 }))
    const r500 = await checkForAppUpdates()
    expect(r500.status).toBe('error')
    expect(r500.message).toContain('500')

    mockFetch(async () => {
      throw new Error('ENOTFOUND api.github.com')
    })
    const rNet = await checkForAppUpdates()
    expect(rNet.status).toBe('error')
    expect(rNet.message).toContain('ENOTFOUND')
  })

  it('release chưa có tag → coi là mới nhất, không báo cập nhật giả', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    expect((await checkForAppUpdates()).status).toBe('up-to-date')
  })
})
