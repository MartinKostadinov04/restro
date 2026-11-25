// The two small pieces the settings lists draw rows with: a label above its control on a phone and
// beside it on a wide screen, and the value a role that may not change shows instead of a control.
import { Label } from '@/components/ui/label'

/**
 * One setting: its label (and a line under it that names the consequence) and its control. The label
 * wraps at any width, so the longest Bulgarian text still fits a row at 390 px.
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string
  htmlFor: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
      <div className="grid min-w-0 flex-1 basis-56 grid-cols-1 gap-0.5">
        <Label htmlFor={htmlFor} className="break-words font-normal">
          {label}
        </Label>
        {description === undefined ? null : (
          <p className="break-words text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

/** A saved value shown as text, for a role that may read but not change it. */
export function SettingValue({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span className="font-medium tabular-nums" data-testid={testId}>
      {children}
    </span>
  )
}
