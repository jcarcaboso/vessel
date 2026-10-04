import { ArrowDownUp, CircleAlert, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlayDraft } from './draft'
import { planFixes, planIssues } from './planChecks'

/** Problems in the plan, with the corrections that clear them. Shown between the play fields and the workspace. */
export function PlanNotices({ draft, onChange, readOnly = false }: {
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  readOnly?: boolean
}) {
  const issues = planIssues(draft.entries, draft.direction)
  if (!issues.length) return null
  const { swapped, reversed } = planFixes(draft)
  const other = draft.direction === 'long' ? 'Short' : 'Long'
  return <section className="plays-notifications" aria-label="Plan notifications">
    <div className="plays-notification is-error" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <div className="plays-notification-body">
        <strong>The stops and targets do not fit a {draft.direction}{readOnly ? '' : '. Fix them before saving.'}</strong>
        <ul>{issues.map(issue => <li key={issue.levelId}>{issue.message}</li>)}</ul>
      </div>
      {!readOnly && (swapped || reversed) && <div className="plays-notification-actions">
        {swapped && <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...draft, entries: swapped })}>
          <ArrowDownUp size={13} aria-hidden="true" />Swap stops and targets</Button>}
        {reversed && <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...draft, direction: reversed })}>
          <Repeat size={13} aria-hidden="true" />Switch to {other}</Button>}
      </div>}
    </div>
  </section>
}
