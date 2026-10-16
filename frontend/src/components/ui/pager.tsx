import { ChevronLeft, ChevronRight } from 'lucide-react'
import { NativeSelect } from './native-select'
import { pageCount, pageItems, pageSizes } from './paging'
import './pager.css'

const count = new Intl.NumberFormat('en-US')

/**
 * Numbered pages for a server-paged list: "1–25 of 1,234", Previous/Next, the first, last, current and
 * neighbouring pages, and Rows per page. Buttons hide when everything fits on one page; `disabled` holds
 * the controls while the next page loads.
 */
export function Pager({ label, page, pageSize, totalCount, onPage, onPageSize, disabled = false }: {
  /** Names the navigation landmark, for example "Activity pages". */
  label: string
  page: number
  pageSize: number
  totalCount: number
  onPage: (page: number) => void
  /** Omit to hide the Rows per page selector. */
  onPageSize?: (pageSize: number) => void
  disabled?: boolean
}) {
  if (totalCount <= 0) return null
  const pages = pageCount(totalCount, pageSize)
  const current = Math.min(Math.max(1, page), pages)
  const first = (current - 1) * pageSize + 1, last = Math.min(totalCount, current * pageSize)
  // The selector matters only when a larger page would show more, or the owner already chose one.
  const sizes = onPageSize && (totalCount > pageSizes[0] || pageSize !== pageSizes[0])
  return <nav className="pager" aria-label={label} aria-busy={disabled || undefined}>
    <p className="pager-summary">{count.format(first)}–{count.format(last)} of {count.format(totalCount)}</p>
    {pages > 1 && <div className="pager-pages">
      <button type="button" className="pager-step" disabled={disabled || current === 1} onClick={() => onPage(current - 1)}><ChevronLeft size={14} aria-hidden="true" />Previous</button>
      {pageItems(current, pages).map(item => typeof item === 'number'
        ? <button key={item} type="button" className="pager-page" aria-current={item === current ? 'page' : undefined} disabled={disabled}
          onClick={() => { if (item !== current) onPage(item) }}>{count.format(item)}</button>
        : <span key={item} className="pager-gap" aria-hidden="true">…</span>)}
      <button type="button" className="pager-step" disabled={disabled || current === pages} onClick={() => onPage(current + 1)}>Next<ChevronRight size={14} aria-hidden="true" /></button>
    </div>}
    {sizes && <label className="pager-size">Rows per page<NativeSelect density="compact" value={pageSize} disabled={disabled}
      onChange={event => onPageSize(Number(event.target.value))}>{pageSizes.map(size => <option key={size} value={size}>{size}</option>)}</NativeSelect></label>}
  </nav>
}
