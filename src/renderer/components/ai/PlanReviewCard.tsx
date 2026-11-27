import { ClipboardCheck, Eye, Play } from 'lucide-react'

interface PlanReviewCardProps {
  title: string
  disabled: boolean
  executorLabel?: string
  onOpenPlan?: () => void
  onApproveAndExecute: () => void
}

export function PlanReviewCard({
  title,
  disabled,
  executorLabel,
  onOpenPlan,
  onApproveAndExecute
}: PlanReviewCardProps): React.JSX.Element {
  return (
    <div
      className="mt-3 rounded-xl border p-3.5 flex items-center justify-between gap-3"
      style={{
        backgroundColor: 'var(--accent-soft)',
        borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)'
      }}
    >
      <div
        onClick={() => onOpenPlan?.()}
        className={`flex items-center gap-2.5 min-w-0 flex-1 ${onOpenPlan ? 'cursor-pointer hover:opacity-85' : ''}`}
        title={onOpenPlan ? 'Bấm để mở Plan ở Side Panel bên phải' : undefined}
      >
        <ClipboardCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
            {title} (Chế độ Plan — chưa sửa file)
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>
            Duyệt kế hoạch này để tự động chuyển sang quyền Cho sửa file và triển khai ngay.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onOpenPlan && (
          <button
            type="button"
            onClick={onOpenPlan}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
            title="Xem chi tiết Plan ở Side Panel"
          >
            <Eye className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>Xem Plan</span>
          </button>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={onApproveAndExecute}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity disabled:opacity-40 cursor-pointer"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Play className="w-3.5 h-3.5" />
          <span>{executorLabel ? `Duyệt & Thực thi (${executorLabel})` : 'Duyệt & Thực thi'}</span>
        </button>
      </div>
    </div>
  )
}
