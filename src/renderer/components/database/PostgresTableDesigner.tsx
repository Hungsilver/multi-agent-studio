import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PostgresColumnDefinition, PostgresRelation, PostgresStructureChange, PostgresTableStructure } from '@shared/types/database'
import { postgresColumnTypes, postgresStructureSql } from '@shared/utils/postgres-structure'
import { formatIpcError } from '../../lib/os-actions'

const control = 'w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs disabled:opacity-50'
const button = 'btn-ghost inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 disabled:opacity-50'
const primary = 'rounded bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50'
const blankColumn = (): PostgresColumnDefinition => ({ name: '', type: 'text', notNull: false })
type Column = PostgresTableStructure['columns'][number]
type EditorMode = 'overview' | 'edit-table' | 'add-column' | 'edit-column' | 'drop-table' | 'drop-column'

export type TableDesignerTarget = { operation: 'create'; schema: string } | { operation: 'manage'; relation: PostgresRelation }

function ColumnFields({ value, onChange }: {
  value: PostgresColumnDefinition
  onChange: (next: PostgresColumnDefinition) => void
}): React.JSX.Element {
  const integer = ['smallint', 'integer', 'bigint'].includes(value.type)
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">Tên cột
          <input required className={control} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
        </label>
        <label className="grid gap-1">Kiểu PostgreSQL
          <input required list="postgres-structure-column-types" className={control} value={value.type}
            onChange={(event) => {
              const type = event.target.value
              onChange({ ...value, type, identity: value.identity && ['smallint', 'integer', 'bigint'].includes(type) })
            }} />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-1"><input type="checkbox" checked={value.primaryKey ?? false}
          onChange={(event) => onChange({ ...value, primaryKey: event.target.checked })} />PRIMARY KEY</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={value.notNull || Boolean(value.primaryKey || value.identity)}
          disabled={value.primaryKey || value.identity} onChange={(event) => onChange({ ...value, notNull: event.target.checked })} />NOT NULL</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={value.unique ?? false}
          onChange={(event) => onChange({ ...value, unique: event.target.checked })} />UNIQUE</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={value.identity ?? false} disabled={!integer}
          onChange={(event) => onChange({ ...value, identity: event.target.checked, defaultValue: undefined })} />IDENTITY</label>
      </div>
      <label className="flex items-center gap-1"><input type="checkbox" checked={value.defaultValue !== undefined} disabled={value.identity}
        onChange={(event) => onChange({ ...value, defaultValue: event.target.checked ? '' : undefined })} />Đặt giá trị mặc định</label>
      {value.defaultValue !== undefined && <input aria-label="Giá trị mặc định" className={control} value={value.defaultValue}
        onChange={(event) => onChange({ ...value, defaultValue: event.target.value })} />}
    </div>
  )
}

function Dependencies({ structure, column }: { structure: PostgresTableStructure; column?: Column }): React.JSX.Element {
  const related = structure.dependencies.filter((dependency) => !column || !dependency.columns.length ||
    dependency.columns.includes(0) || dependency.columns.includes(column.number))
  return (
    <details className="rounded border border-[var(--border)] p-2" open>
      <summary className="cursor-pointer font-medium">Ràng buộc và phụ thuộc liên quan ({related.length})</summary>
      {related.length ? (
        <ul className="mt-2 max-h-44 space-y-1 overflow-auto">
          {related.map((dependency, index) => <li key={index} className="break-words rounded bg-[var(--bg)] p-2">
            <span>{dependency.name}</span>
            {dependency.definition && <code className="mt-0.5 block whitespace-pre-wrap text-[var(--muted)]">{dependency.definition}</code>}
          </li>)}
        </ul>
      ) : <p className="mt-1 text-[var(--muted)]">Catalog chưa ghi nhận phụ thuộc liên quan.</p>}
    </details>
  )
}

export function PostgresTableDesigner({ target, connectionId, schemas, onClose, onApply }: {
  target: TableDesignerTarget
  connectionId: string
  schemas: string[]
  onClose: () => void
  onApply: (change: PostgresStructureChange) => Promise<void>
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const table = target.operation === 'manage' ? target.relation : null
  const [structure, setStructure] = useState<PostgresTableStructure | null>(null)
  const [loading, setLoading] = useState(Boolean(table))
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<EditorMode>('overview')
  const [column, setColumn] = useState<Column | null>(null)
  const [schema, setSchema] = useState(target.operation === 'create' ? target.schema : target.relation.schema)
  const [tableName, setTableName] = useState(table?.name ?? '')
  const [comment, setComment] = useState('')
  const [definition, setDefinition] = useState<PostgresColumnDefinition>(blankColumn)
  const [columns, setColumns] = useState<PostgresColumnDefinition[]>([{ name: 'id', type: 'bigint', notNull: true, primaryKey: true, identity: true }])
  const [type, setType] = useState('')
  const [defaultMode, setDefaultMode] = useState<'keep' | 'remove' | 'value'>('keep')
  const [preview, setPreview] = useState<{ change: PostgresStructureChange; sql: string } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => { dialog.current?.showModal() }, [])

  useEffect(() => {
    if (!table) return
    let cancelled = false
    setLoading(true)
    setError('')
    void Promise.resolve().then(() => window.workspaceApi.readPostgresTableStructure(connectionId, table.schema, table.name)).then((result) => {
      if (!cancelled) {
        setStructure(result)
        setComment(result.comment ?? '')
      }
    }).catch((cause) => {
      if (!cancelled) setError(formatIpcError(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [connectionId, table, revision])

  function start(next: EditorMode, selected?: Column): void {
    setError('')
    setMode(next)
    setColumn(selected ?? null)
    setDefinition(selected ? { name: selected.name, type: selected.type, notNull: selected.notNull } : blankColumn())
    setType('')
    setDefaultMode('keep')
    if (table) { setSchema(table.schema); setTableName(table.name) }
    setComment(structure?.comment ?? '')
  }

  function review(): void {
    setError('')
    try {
      let change: PostgresStructureChange
      if (!table) {
        change = { op: 'create-table', schema: schema.trim(), table: tableName.trim(),
          columns: columns.map((item) => ({ ...item, name: item.name.trim(), type: item.type.trim() })) }
      } else {
        if (!structure) return
        const target = { schema: table.schema, table: table.name, revision: structure.revision }
        switch (mode) {
          case 'edit-table':
            change = { ...target, op: mode,
              name: tableName === table.name ? table.name : tableName.trim(),
              newSchema: schema === table.schema ? table.schema : schema.trim(),
              comment: comment !== (structure.comment ?? '') ? comment : undefined }
            break
          case 'add-column':
            change = { ...target, op: mode, definition: { ...definition, name: definition.name.trim(), type: definition.type.trim() } }
            break
          case 'edit-column':
            if (!column) return
            change = { ...target, op: mode, column: column.name, name: definition.name === column.name ? column.name : definition.name.trim(),
              type: type.trim() || undefined, notNull: definition.notNull !== column.notNull ? definition.notNull : undefined,
              defaultValue: defaultMode === 'keep' ? undefined : defaultMode === 'remove' ? null : definition.defaultValue ?? '' }
            break
          case 'drop-column':
            if (!column) return
            change = { ...target, op: mode, column: column.name }
            break
          case 'drop-table':
            change = { ...target, op: mode }
            break
          default:
            return
        }
      }
      const sql = postgresStructureSql(change).join('\n')
      if (!sql) throw new Error('Chưa có thay đổi cấu trúc.')
      setPreview({ change, sql })
    } catch (cause) {
      setError(formatIpcError(cause))
    }
  }

  async function apply(): Promise<void> {
    if (!preview || saving) return
    setSaving(true)
    setError('')
    try {
      await onApply(preview.change)
      dialog.current?.close()
    } catch (cause) {
      setError(formatIpcError(cause))
    } finally {
      setSaving(false)
    }
  }

  const dropping = preview?.change.op === 'drop-column' || preview?.change.op === 'drop-table'
  const editingColumn = mode === 'edit-column' && column
  return (
    <dialog ref={dialog} aria-labelledby="postgres-table-designer-title"
      className="m-auto max-h-[85vh] w-[min(44rem,calc(100%-2rem))] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text)] backdrop:bg-black/50"
      onClose={onClose} onCancel={(event) => { if (saving) event.preventDefault() }} onKeyDown={(event) => event.stopPropagation()}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (preview) void apply(); else review() }}>
        <h3 id="postgres-table-designer-title" className="break-all text-sm font-semibold">{table ? `Cấu trúc ${table.schema}.${table.name}` : 'Tạo bảng PostgreSQL'}</h3>
        <datalist id="postgres-structure-column-types">{postgresColumnTypes.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="postgres-structure-schemas">{schemas.map((item) => <option key={item} value={item} />)}</datalist>
        {loading && <p role="status">Đang đọc cấu trúc bảng…</p>}
        {preview ? (
          <>
            {dropping && <p className="rounded border border-[var(--warn)] p-2 text-[var(--warn)]">
              Dữ liệu bị xóa cùng {preview.change.op === 'drop-table' ? 'bảng' : 'cột'}. PostgreSQL có thể xóa kèm index và ràng buộc nội bộ. RESTRICT sẽ chặn khi còn phụ thuộc bên ngoài.
            </p>}
            {structure && <Dependencies structure={structure} column={column ?? undefined} />}
            <pre aria-label="SQL thay đổi cấu trúc" className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-3">{preview.sql}</pre>
          </>
        ) : !loading && (!table || structure) && (
          <>
            {(!table || mode === 'edit-table') && <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">Schema
                <input required list="postgres-structure-schemas" className={control} value={schema} onChange={(event) => setSchema(event.target.value)} />
              </label>
              <label className="grid gap-1">Tên bảng
                <input required className={control} value={tableName} onChange={(event) => setTableName(event.target.value)} />
              </label>
            </div>}
            {!table && <>
              {columns.map((item, index) => <fieldset key={index} className="grid gap-2 rounded border border-[var(--border)] p-2">
                <legend className="px-1">Cột {index + 1}</legend>
                <ColumnFields value={item} onChange={(next) => setColumns((current) => current.map((value, i) => i === index ? next : value))} />
                <button type="button" className={`${button} justify-self-end`} disabled={columns.length === 1}
                  onClick={() => setColumns((current) => current.filter((_, i) => i !== index))}>Bỏ cột {index + 1}</button>
              </fieldset>)}
              <button type="button" className={`${button} justify-self-start`} onClick={() => setColumns((current) => [...current, blankColumn()])}>Thêm cột</button>
            </>}
            {table && structure && mode === 'overview' && <>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} onClick={() => start('add-column')}><Plus className="size-3" />Thêm cột</button>
                <button type="button" className={button} onClick={() => start('edit-table')}><Pencil className="size-3" />Sửa bảng</button>
                <button type="button" className={`${button} text-[var(--err)]`} onClick={() => start('drop-table')}><Trash2 className="size-3" />Xóa bảng</button>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left">
                  <thead><tr className="border-b border-[var(--border)]"><th>Cột</th><th>Kiểu</th><th>Ràng buộc</th><th className="sr-only">Thao tác</th></tr></thead>
                  <tbody>{structure.columns.map((item) => (
                    <tr key={item.number} className="border-b border-[var(--border)]">
                      <td className="break-all py-1.5">{item.name}</td><td className="break-all">{item.type}</td>
                      <td className="break-all text-[var(--muted)]">{[item.notNull && 'NOT NULL', item.identity && 'IDENTITY', item.generated && 'GENERATED', item.defaultSql && `DEFAULT ${item.defaultSql}`].filter(Boolean).join(' · ')}</td>
                      <td><div className="flex justify-end gap-1">
                        <button type="button" aria-label={`Sửa cột ${item.name}`} className={button} onClick={() => start('edit-column', item)}><Pencil className="size-3" /></button>
                        <button type="button" aria-label={`Xóa cột ${item.name}`} className={`${button} text-[var(--err)]`} onClick={() => start('drop-column', item)}><Trash2 className="size-3" /></button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <Dependencies structure={structure} />
            </>}
            {mode === 'edit-table' && <label className="grid gap-1">Ghi chú bảng
              <textarea className={control} value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>}
            {mode === 'add-column' && <ColumnFields value={definition} onChange={setDefinition} />}
            {editingColumn && <>
              <label className="grid gap-1">Tên cột
                <input required className={control} value={definition.name} onChange={(event) => setDefinition({ ...definition, name: event.target.value })} />
              </label>
              <label className="grid gap-1">Đổi kiểu cột
                <input list="postgres-structure-column-types" className={control} placeholder={column.type} value={type}
                  disabled={column.generated || column.identity} onChange={(event) => setType(event.target.value)} />
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={definition.notNull} onChange={(event) => setDefinition({ ...definition, notNull: event.target.checked })} />NOT NULL
              </label>
              <label className="grid gap-1">Giá trị mặc định {column.defaultSql ? `(hiện tại: ${column.defaultSql})` : ''}
                <select className={control} value={defaultMode} disabled={column.generated || column.identity}
                  onChange={(event) => setDefaultMode(event.target.value as typeof defaultMode)}>
                  <option value="keep">Giữ nguyên</option><option value="remove">Bỏ mặc định</option><option value="value">Đặt giá trị mới</option>
                </select>
              </label>
              {defaultMode === 'value' && <input aria-label="Giá trị mặc định" className={control} value={definition.defaultValue ?? ''}
                onChange={(event) => setDefinition({ ...definition, defaultValue: event.target.value })} />}
            </>}
            {mode === 'drop-table' && <p>Xem SQL và các phụ thuộc trước khi xóa bảng <strong>{table?.name}</strong>.</p>}
            {mode === 'drop-column' && <p>Xem SQL và các phụ thuộc trước khi xóa cột <strong>{column?.name}</strong>.</p>}
          </>
        )}
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-[var(--err)]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {table && !loading && <button type="button" className={button} disabled={saving} onClick={() => {
            setPreview(null); start('overview'); setRevision((value) => value + 1)
          }}>Tải lại cấu trúc</button>}
          <button type="button" className={button} disabled={saving} onClick={() => dialog.current?.close()}>Đóng</button>
          {preview ? <>
            <button type="button" className={button} disabled={saving} onClick={() => { setPreview(null); setError('') }}>Quay lại</button>
            <button type="submit" className={dropping ? 'rounded border border-[var(--err)] px-3 py-1.5 text-[var(--err)]' : primary}
              disabled={saving}>{saving ? 'Đang áp dụng…' : dropping ? 'Xác nhận xóa' : 'Áp dụng'}</button>
          </> : !loading && (!table || (structure && mode !== 'overview')) && <>
            {table && <button type="button" className={button} onClick={() => start('overview')}>Quay lại</button>}
            <button type="submit" className={primary}>Xem SQL</button>
          </>}
        </div>
      </form>
    </dialog>
  )
}
