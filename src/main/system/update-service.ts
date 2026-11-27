import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { AppUpdateInfo, AppVersionInfo } from '@shared/types/workspace'

const execFileAsync = promisify(execFile)

export const REPO_OWNER = 'Hungsilver'
export const REPO_NAME = 'multi-agent-studio'
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`
export const RELEASES_URL = `${REPO_URL}/releases`

export function getAppRootDir(): string {
  return app.getAppPath()
}

export function getAppVersionInfo(): AppVersionInfo {
  return {
    version: app.getVersion(),
    installMode: app.isPackaged ? 'packaged' : 'source',
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_URL
  }
}

export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)

  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length, 3)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

export async function checkForAppUpdates(): Promise<AppUpdateInfo> {
  const currentVersion = app.getVersion()
  const installMode: 'packaged' | 'source' = app.isPackaged ? 'packaged' : 'source'
  const appRoot = getAppRootDir()

  // Chế độ chạy từ mã nguồn: ưu tiên kiểm tra qua git fetch (hoạt động cả với repo Private)
  if (!app.isPackaged && fs.existsSync(path.join(appRoot, '.git'))) {
    try {
      await execFileAsync('git', ['fetch', 'origin', 'main', '--quiet'], {
        cwd: appRoot,
        timeout: 10000,
        windowsHide: true
      })
      const { stdout } = await execFileAsync('git', ['rev-list', '--count', 'HEAD..origin/main'], {
        cwd: appRoot,
        timeout: 5000,
        windowsHide: true
      })
      const commitsBehind = Number.parseInt(stdout.trim(), 10) || 0
      if (commitsBehind > 0) {
        return {
          currentVersion,
          installMode,
          repoUrl: REPO_URL,
          releasesUrl: RELEASES_URL,
          status: 'update-available',
          commitsBehind,
          releaseUrl: RELEASES_URL,
          message: `Có ${commitsBehind} commit mới trên nhánh main. Nhấn "Cập nhật từ Git" hoặc chạy scripts\\update.ps1.`
        }
      }
      return {
        currentVersion,
        installMode,
        repoUrl: REPO_URL,
        releasesUrl: RELEASES_URL,
        status: 'up-to-date',
        commitsBehind: 0,
        releaseUrl: RELEASES_URL,
        message: 'Mã nguồn đang ở bản mới nhất trên GitHub (main).'
      }
    } catch {
      // Nếu git fetch lỗi (vd: chưa có remote hoặc mạng), fallback sang kiểm tra GitHub Releases API
    }
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Multi-Agent-Studio'
    }
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(8000)
    })

    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return {
        currentVersion,
        installMode,
        repoUrl: REPO_URL,
        releasesUrl: RELEASES_URL,
        status: 'private-or-unreachable',
        releaseUrl: RELEASES_URL,
        message:
          'Repository đang ở chế độ Private (hoặc chưa có bản Release). Hãy mở trang GitHub Releases trên trình duyệt đã đăng nhập để tải bản mới nhất.'
      }
    }

    if (!res.ok) {
      return {
        currentVersion,
        installMode,
        repoUrl: REPO_URL,
        releasesUrl: RELEASES_URL,
        status: 'error',
        releaseUrl: RELEASES_URL,
        message: `Không thể kiểm tra cập nhật (HTTP ${res.status}).`
      }
    }

    const data = (await res.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
    }
    const latestTag = (data.tag_name || '').trim()
    const latestClean = latestTag.replace(/^v/i, '')
    const releaseUrl = data.html_url || RELEASES_URL

    if (latestClean && compareSemver(latestClean, currentVersion) > 0) {
      return {
        currentVersion,
        installMode,
        repoUrl: REPO_URL,
        releasesUrl: RELEASES_URL,
        status: 'update-available',
        latestVersion: latestClean,
        releaseUrl,
        releaseNotes: data.body?.slice(0, 600),
        message: `Đã có phiên bản mới v${latestClean} (bạn đang dùng v${currentVersion}). Mở Releases để tải bộ cài mới.`
      }
    }

    return {
      currentVersion,
      installMode,
      repoUrl: REPO_URL,
      releasesUrl: RELEASES_URL,
      status: 'up-to-date',
      latestVersion: latestClean || currentVersion,
      releaseUrl,
      message: `Bạn đang dùng phiên bản mới nhất (v${currentVersion}).`
    }
  } catch (err) {
    return {
      currentVersion,
      installMode,
      repoUrl: REPO_URL,
      releasesUrl: RELEASES_URL,
      status: 'error',
      releaseUrl: RELEASES_URL,
      message: `Lỗi kết nối khi kiểm tra cập nhật: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
