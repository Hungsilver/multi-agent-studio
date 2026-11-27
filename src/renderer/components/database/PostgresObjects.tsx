import { ChevronDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { quotePostgresIdentifier as quote } from '@shared/utils/postgres-preview'
import type { PostgresObject, PostgresObjectKind, PostgresRelation } from '@shared/types/database'

const labels = {
  index: 'Index', function: 'Function', procedure: 'Stored procedure', trigger: 'Trigger'
} satisfies Record<PostgresObjectKind, string>
const kinds = Object.keys(labels) as PostgresObjectKind[]
const inputClass = 'min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs'
const iconClass = 'btn-ghost shrink-0 rounded p-1 disabled:opacity-50'
const relationId = ({ schema, name }: PostgresRelation): string => JSON.stringify([schema, name])

function createTemplate(kind: PostgresObjectKind, name: string, schema: string, table: PostgresRelation | undefined,
  columnNames: string[], unique: boolean): string {
  const qualified = `${quote(schema)}.${quote(name)}`
  if (kind === 'function') {
    return `CREATE FUNCTION ${qualified}(value integer)
RETURNS integer
LANGUAGE sql
AS $$
  SELECT value;
$$;

-- SELECT ${qualified}(1);`
  }
  if (kind === 'procedure') {
    return `CREATE PROCEDURE ${qualified}()
LANGUAGE plpgsql
AS $$
BEGIN
  NULL; -- Thêm câu lệnh ở đây
END;
$$;

-- CALL ${qualified}();`
  }
  if (!table) throw new Error('Hãy chọn bảng.')
  const target = `${quote(table.schema)}.${quote(table.name)}`
  if (kind === 'index') {
    return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${quote(name)}
ON ${target} USING btree (${columnNames.map(quote).join(', ')});`
  }
  const handler = `${quote(table.schema)}.${quote(name)}`
  return `CREATE FUNCTION ${handler}()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Thêm xử lý với NEW tại đây.
  RETURN NEW;
END;
$$;

CREATE TRIGGER ${quote(name)}
BEFORE INSERT OR UPDATE ON ${target}
FOR EACH ROW
EXECUTE FUNCTION ${handler}();`
}

export function PostgresObjects({ objects, relations, selected, busy, onLoad, onOpen, onDraft, onColumns, onDrop }: {
  objects: PostgresObject[] | null
  relations: PostgresRelation[]
  selected: PostgresRelation | null
  busy: boolean
  onLoad: () => void
  onOpen: (object: PostgresObject) => void
  onDraft: (name: string, sql: string) => void
  onColumns: (table: PostgresRelation) => Promise<string[]>
  onDrop: (object: PostgresObject) => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const [deleting, setDeleting] = useState<PostgresObject | null>(null)
  const columnRequest = useRef(0)
  const [kind, setKind] = useState<PostgresObjectKind>('index')
  const [name, setName] = useState('')
  const [schema, setSchema] = useState('public')
  const [target, setTarget] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [unique, setUnique] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const schemas = [...new Set(['public', ...relations.map((table) => table.schema), ...(objects ?? []).map((object) => object.schema)])].sort()
  const tables = relations.filter((table) => table.kind === 'table' || (kind === 'index' && table.kind === 'materialized view'))
  const table = tables.find((item) => relationId(item) === target)
  const forTable = kind === 'index' || kind === 'trigger'

  function loadColumns(value: string, available: PostgresRelation[]): void {
    setTarget(value)
    setColumns([])
    setPicked([])
    const request = ++columnRequest.current
    const relation = available.find((item) => relationId(item) === value)
    setLoadingColumns(Boolean(relation))
    if (!relation) return
    void onColumns(relation).then((names) => {
      if (request !== columnRequest.current) return
      setColumns(names)
      if (!names.length) setError('Không tìm thấy cột để tạo index.')
    }).catch(() => {
      if (request === columnRequest.current) setError('Không đọc được danh sách cột.')
    }).finally(() => {
      if (request === columnRequest.current) setLoadingColumns(false)
    })
  }

  function start(next: PostgresObjectKind): void {
    setKind(next)
    setName('')
    setSchema(selected?.schema ?? 'public')
    setUnique(false)
    setError('')
    const allowed = relations.filter((item) => item.kind === 'table' || (next === 'index' && item.kind === 'materialized view'))
    const candidate = selected && allowed.find((item) => relationId(item) === relationId(selected))
    if (next === 'index') loadColumns(candidate ? relationId(candidate) : '', allowed)
    else setTarget(candidate ? relationId(candidate) : '')
    dialog.current?.showModal()
  }

  return (
    <section aria-label="Đối tượng PostgreSQL" className="mt-2 border-t border-[var(--border)] pt-2 text-xs">
      <div className="flex items-center justify-between gap-1 px-1">
        <h3 className="font-semibold">Đối tượng PostgreSQL</h3>
        <button type="button" disabled={busy} aria-label="Làm mới đối tượng PostgreSQL" title="Làm mới đối tượng PostgreSQL"
          className={iconClass} onClick={onLoad}><RefreshCw className="size-3.5" aria-hidden="true" /></button>
      </div>
      {objects ? (
        <input aria-label="Tìm đối tượng PostgreSQL" placeholder="Tìm đối tượng…" value={search}
          onChange={(event) => setSearch(event.target.value)} className={`${inputClass} my-1 w-full`} />
      ) : <button type="button" disabled={busy} className="btn-ghost my-1 rounded px-2 py-1 disabled:opacity-50" onClick={onLoad}>Tải danh sách</button>}
      {kinds.map((type) => {
        const filter = search.trim().toLowerCase()
        const matches = objects?.filter((item) => item.kind === type && `${item.schema}.${item.table ?? ''}.${item.name} ${item.detail}`.toLowerCase().includes(filter))
        return (
          <div key={type} className="flex items-start gap-1">
            <details className="min-w-0 flex-1">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1 py-1">
                <ChevronDown className="size-3" aria-hidden="true" />{labels[type]}{matches && <span className="text-[var(--muted)]">({matches.length})</span>}
              </summary>
              {matches?.map((item) => (
                <div key={item.oid} className="flex items-center gap-0.5">
                  <button type="button" disabled={busy} className="btn-ghost min-w-0 flex-1 rounded px-2 py-1 text-left"
                    title={`${item.schema}.${item.table ? item.table + '.' : ''}${item.name} · ${item.detail}`} onClick={() => onOpen(item)}>
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-[var(--muted)]">{item.schema}{item.table ? `.${item.table}` : ''}{item.detail ? ` · ${item.detail}` : ''}</span>
                  </button>
                  <button type="button" disabled={busy} className={`${iconClass} text-[var(--muted)] hover:text-[var(--err)]`}
                    aria-label={`Xóa ${labels[type]} ${item.name}`}
                    title={`Xóa ${item.schema}.${item.table ? item.table + '.' : ''}${item.name}`}
                    onClick={() => { setDeleting(item); deleteDialog.current?.showModal() }}><Trash2 className="size-3" aria-hidden="true" /></button>
                </div>
              ))}
              {matches?.length === 0 && <p className="px-2 py-1 text-[var(--muted)]">Không có đối tượng.</p>}
            </details>
            <button type="button" disabled={busy} className={iconClass} aria-label={`Tạo ${labels[type]}`} title={`Tạo ${labels[type]}`}
              onClick={() => start(type)}><Plus className="size-3.5" aria-hidden="true" /></button>
          </div>
        )
      })}
      <dialog ref={dialog} aria-labelledby="postgres-create-object-title"
        className="m-auto max-h-[80vh] w-[min(30rem,calc(100%-2rem))] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] backdrop:bg-black/50"
        onKeyDown={(event) => event.stopPropagation()}>
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault()
          const identifier = name.trim()
          if (!identifier || new TextEncoder().encode(identifier).length > 63) {
            setError('Tên PostgreSQL phải dài từ 1 đến 63 byte.')
            return
          }
          const schemaName = schema.trim()
          if (!forTable && (!schemaName || new TextEncoder().encode(schemaName).length > 63)) {
            setError('Tên schema phải dài từ 1 đến 63 byte.')
            return
          }
          if ((forTable && !table) || (kind === 'index' && !picked.length)) return
          onDraft(identifier, createTemplate(kind, identifier, schemaName, table, picked, unique))
          dialog.current?.close()
        }}>
          <h3 id="postgres-create-object-title" className="text-sm font-semibold">Tạo {labels[kind]}</h3>
          <label className="grid gap-1">Tên
            <input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          {forTable ? (
            <label className="grid gap-1">Bảng
              <select required value={target} disabled={busy || loadingColumns} className={inputClass} onChange={(event) => {
                setError('')
                if (kind === 'index') loadColumns(event.target.value, tables)
                else setTarget(event.target.value)
              }}>
                <option value="">Chọn bảng…</option>
                {tables.map((item) => <option key={relationId(item)} value={relationId(item)}>{item.schema}.{item.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="grid gap-1">Schema
              <input required list="postgres-object-schemas" value={schema} onChange={(event) => setSchema(event.target.value)} className={inputClass} />
              <datalist id="postgres-object-schemas">
                {schemas.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
          )}
          {kind === 'index' && <>
            <fieldset className="max-h-44 overflow-auto rounded border border-[var(--border)] p-2" disabled={loadingColumns}>
              <legend className="px-1">Cột theo thứ tự chọn</legend>
              {loadingColumns && <p role="status">Đang tải cột…</p>}
              {columns.map((column) => (
                <label key={column} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={picked.includes(column)}
                    onChange={(event) => setPicked((current) => event.target.checked ? [...current, column] : current.filter((value) => value !== column))} />
                  <span>{column}{picked.includes(column) ? ` (${picked.indexOf(column) + 1})` : ''}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2"><input type="checkbox" checked={unique} onChange={(event) => setUnique(event.target.checked)} />UNIQUE</label>
          </>}
          {error && <p role="alert" className="text-[var(--err)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost rounded px-3 py-1.5" onClick={() => dialog.current?.close()}>Hủy</button>
            <button type="submit" disabled={busy || loadingColumns || (kind === 'index' && !picked.length)}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50">Mở SQL</button>
          </div>
        </form>
      </dialog>
      <dialog ref={deleteDialog} aria-labelledby="postgres-delete-object-title"
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] backdrop:bg-black/50"
        onClose={() => setDeleting(null)} onKeyDown={(event) => event.stopPropagation()}>
        {deleting && (
          <form className="grid gap-3" onSubmit={(event) => {
            event.preventDefault()
            if (busy) return
            deleteDialog.current?.close()
            onDrop(deleting)
          }}>
            <h3 id="postgres-delete-object-title" className="text-sm font-semibold">Xóa {labels[deleting.kind]}?</h3>
            <p className="break-all font-mono">
              {deleting.schema}.{deleting.table ? deleting.table + '.' : ''}{deleting.name}
              {deleting.kind === 'function' || deleting.kind === 'procedure' ? `(${deleting.detail})` : ''}
            </p>
            <p className="text-[var(--muted)]">PostgreSQL sẽ chặn thao tác nếu đối tượng còn phụ thuộc.</p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus className="btn-ghost rounded px-3 py-1.5" onClick={() => deleteDialog.current?.close()}>Hủy</button>
              <button type="submit" disabled={busy} className="rounded border border-[var(--err)] px-3 py-1.5 font-medium text-[var(--err)] disabled:opacity-50">Xóa đối tượng</button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  )
}
