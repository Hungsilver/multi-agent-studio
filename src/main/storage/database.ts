import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

const require = createRequire(import.meta.url)

let sqlStaticPromise: Promise<SqlJsStatic> | null = null

function resolveSqlWasmPath(): string {
  const resolvedJs = require.resolve('sql.js/dist/sql-wasm.js')
  const wasmPath = path.join(path.dirname(resolvedJs), 'sql-wasm.wasm')
  if (wasmPath.includes('app.asar')) {
    const unpackedPath = wasmPath.replace('app.asar', 'app.asar.unpacked')
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath
    }
  }
  return wasmPath
}

async function getSqlStatic(): Promise<SqlJsStatic> {
  if (!sqlStaticPromise) {
    const wasmPath = resolveSqlWasmPath()
    sqlStaticPromise = initSqlJs({
      locateFile: () => wasmPath
    })
  }
  return sqlStaticPromise
}

export function getDefaultDataDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return process.env.AI_CODING_TOOL_DATA || path.join(appData, 'AiCodingTool')
}

export class WorkspaceDatabase {
  private db!: Database
  private readonly dbPath: string
  private readonly inMemory: boolean

  constructor(dbPath?: string) {
    this.inMemory = dbPath === ':memory:'
    if (this.inMemory) {
      this.dbPath = ':memory:'
    } else {
      const target = dbPath ?? path.join(getDefaultDataDir(), 'workspace.db')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      this.dbPath = target
    }
  }

  async init(): Promise<void> {
    const SQL = await getSqlStatic()
    if (!this.inMemory && fs.existsSync(this.dbPath)) {
      const bytes = fs.readFileSync(this.dbPath)
      this.db = new SQL.Database(bytes)
    } else {
      this.db = new SQL.Database()
    }
    this.migrate()
    this.seedDefaults()
    this.persist()
  }

  private migrate(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        title TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        effort TEXT NOT NULL DEFAULT 'medium',
        permission_mode TEXT NOT NULL DEFAULT 'edit',
        worktree_path TEXT,
        worktree_branch TEXT,
        worktree_base_branch TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_provider_states (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        last_synced_turn_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, provider)
      );

      CREATE TABLE IF NOT EXISTS session_memories (
        session_id TEXT PRIMARY KEY,
        goal TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        decisions_json TEXT NOT NULL DEFAULT '[]',
        pinned_notes_json TEXT NOT NULL DEFAULT '[]',
        key_files_json TEXT NOT NULL DEFAULT '[]',
        active_skills_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        user_prompt TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        pre_tree_hash TEXT,
        post_tree_hash TEXT,
        untracked_backup_id TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_usd REAL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        slash_cmd TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global'
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `)
  }

  private seedDefaults(): void {
    const countRows = this.queryAll<{ cnt: number }>('SELECT COUNT(*) as cnt FROM prompt_templates')
    if ((countRows[0]?.cnt ?? 0) === 0) {
      const defaults = [
        {
          id: 'tpl-review',
          slashCmd: '/review',
          title: 'Review code & tìm bug',
          description: 'Kiểm tra logic, edge cases, bảo mật và hiệu năng trên thay đổi hiện tại',
          body: 'Hãy review kỹ các thay đổi hiện tại (hoặc file được đính kèm), tập trung vào: 1) Bug logic & edge cases, 2) Rủi ro bảo mật / hiệu năng, 3) Đề xuất sửa cụ thể.',
          scope: 'global'
        },
        {
          id: 'tpl-fix',
          slashCmd: '/fix-bug',
          title: 'Phân tích & sửa lỗi triệt để',
          description: 'Tìm nguyên nhân gốc, sửa code và bổ sung test kiểm chứng',
          body: 'Hãy tìm nguyên nhân gốc của lỗi này, không sửa kiểu vá tạm. Sau khi sửa, giải thích nguyên nhân và chạy test/build liên quan để kiểm chứng.',
          scope: 'global'
        },
        {
          id: 'tpl-tests',
          slashCmd: '/write-tests',
          title: 'Viết Unit & Integration Tests',
          description: 'Bổ sung test bao phủ happy path và edge cases',
          body: 'Hãy viết unit/integration tests cho module/hàm vừa chỉ định theo đúng convention test của dự án và chạy test để xác nhận pass.',
          scope: 'global'
        },
        {
          id: 'tpl-refactor',
          slashCmd: '/refactor',
          title: 'Tái cấu trúc sạch & dễ bảo trì',
          description: 'Tách helper, giảm lặp code, giữ nguyên hành vi',
          body: 'Hãy refactor đoạn code liên quan để dễ đọc, bỏ trùng lặp, giữ nguyên hành vi bên ngoài và kiểm tra lại typecheck/test.',
          scope: 'global'
        },
        {
          id: 'tpl-explain',
          slashCmd: '/explain',
          title: 'Giải thích luồng hoạt động',
          description: 'Tóm tắt kiến trúc, luồng dữ liệu và các file liên quan',
          body: 'Hãy giải thích rõ ràng luồng hoạt động, trách nhiệm từng file/hàm chính và các điểm cần lưu ý khi chỉnh sửa.',
          scope: 'global'
        }
      ]
      for (const t of defaults) {
        this.run(
          `INSERT OR IGNORE INTO prompt_templates (id, slash_cmd, title, description, body, scope) VALUES (?, ?, ?, ?, ?, ?)`,
          [t.id, t.slashCmd, t.title, t.description, t.body, t.scope]
        )
      }
    }
  }

  run(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params as (string | number | Uint8Array | null)[])
      stmt.step()
    } finally {
      stmt.free()
    }
  }

  queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    const rows: T[] = []
    try {
      stmt.bind(params as (string | number | Uint8Array | null)[])
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
    } finally {
      stmt.free()
    }
    return rows
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    const rows = this.queryAll<T>(sql, params)
    return rows[0] ?? null
  }

  lastInsertRowId(): number {
    const row = this.queryOne<{ id: number }>('SELECT last_insert_rowid() as id')
    return row?.id ?? 0
  }

  persist(): void {
    if (this.inMemory) return
    const data = this.db.export()
    const tmp = `${this.dbPath}.tmp`
    fs.writeFileSync(tmp, Buffer.from(data))
    fs.renameSync(tmp, this.dbPath)
  }

  close(): void {
    this.persist()
    this.db.close()
  }
}
