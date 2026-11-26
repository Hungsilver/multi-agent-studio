import { ClipboardCheck, Play } from 'lucide-react'

interface PlanReviewCardProps {
  title: string
  disabled: boolean
  onApproveAndExecute: () => void
}

export function PlanReviewCard({ title, disabled, onApproveAndExecute }: PlanReviewCardProps): React.JSX.Element {
  return (
    <div
      className="mt-3 rounded-xl border p-3.5 flex items-center justify-between gap-4"
      style={{
        backgroundColor: 'var(--accent-soft)',
        borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)'
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <ClipboardCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            {title} (Chế độ Plan — chưa sửa file)
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>
            Duyệt kế hoạch này để tự động chuyển sang quyền Cho sửa file và triển khai ngay.
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onApproveAndExecute}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity disabled:opacity-40 cursor-pointer"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        <Play className="w-3.5 h-3.5" />
        <span>Duyệt & Thực thi</span>
      </button>
    </div>
  )
}
