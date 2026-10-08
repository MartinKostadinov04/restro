import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface StagePlaceholderProps {
  icon: LucideIcon
  title: string
  description: string
  /** Already translated, e.g. "Coming in Stage 2". */
  stageLabel: string
}

/** The empty state of a workspace tab whose feature arrives in a later stage. */
export function StagePlaceholder({
  icon: Icon,
  title,
  description,
  stageLabel,
}: StagePlaceholderProps) {
  return (
    <Empty className="min-h-72" data-testid="stage-placeholder">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Badge variant="secondary">{stageLabel}</Badge>
      </EmptyContent>
    </Empty>
  )
}
