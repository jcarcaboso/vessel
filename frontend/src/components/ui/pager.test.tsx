import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDelayedFlag } from '@/lib/use-delayed-flag'
import { Pager } from './pager'
import { pageCount, pageItems } from './paging'
import { Skeleton, SkeletonStatus } from './skeleton'

afterEach(() => vi.useRealTimers())

describe('page items', () => {
  it.each([
    [1, 1, [1]],
    [1, 3, [1, 2, 3]],
    [1, 10, [1, 2, 'gap-end', 10]],
    [4, 10, [1, 2, 3, 4, 5, 'gap-end', 10]],
    [6, 10, [1, 'gap-start', 5, 6, 7, 'gap-end', 10]],
    [10, 10, [1, 'gap-start', 9, 10]],
    [3, 5, [1, 2, 3, 4, 5]],
  ] as const)('page %i of %i shows %j', (page, count, expected) => {
    expect(pageItems(page, count)).toEqual(expected)
  })
  it('counts at least one page', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(1234, 25)).toBe(50)
  })
})

describe('Pager', () => {
  it('summarises the rows, marks the current page and moves between pages', async () => {
    const onPage = vi.fn()
    render(<Pager label="Activity pages" page={1} pageSize={25} totalCount={1234} onPage={onPage} onPageSize={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Activity pages' })
    expect(within(nav).getByText('1–25 of 1,234')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: '50' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(within(nav).getByRole('button', { name: 'Next' }))
    await userEvent.click(within(nav).getByRole('button', { name: '50' }))
    await userEvent.click(within(nav).getByRole('button', { name: '1' }))
    expect(onPage.mock.calls).toEqual([[2], [50]])
  })
  it('shows the last partial page and disables Next there', () => {
    render(<Pager label="Plays pages" page={50} pageSize={25} totalCount={1234} onPage={vi.fn()} />)
    expect(screen.getByText('1,226–1,234 of 1,234')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '50' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument()
  })
  it('hides the page buttons when one page holds everything, and the selector when no larger page would help', () => {
    const { rerender } = render(<Pager label="Activity pages" page={1} pageSize={25} totalCount={7} onPage={vi.fn()} onPageSize={vi.fn()} />)
    expect(screen.getByText('1–7 of 7')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument()
    rerender(<Pager label="Activity pages" page={1} pageSize={50} totalCount={30} onPage={vi.fn()} onPageSize={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50')
    rerender(<Pager label="Activity pages" page={1} pageSize={25} totalCount={0} onPage={vi.fn()} onPageSize={vi.fn()} />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('offers 25, 50 and 100 rows per page', async () => {
    const onPageSize = vi.fn()
    render(<Pager label="Activity pages" page={2} pageSize={25} totalCount={60} onPage={vi.fn()} onPageSize={onPageSize} />)
    const select = screen.getByRole('combobox', { name: 'Rows per page' })
    expect([...select.querySelectorAll('option')].map(option => option.value)).toEqual(['25', '50', '100'])
    await userEvent.selectOptions(select, '100')
    expect(onPageSize).toHaveBeenCalledExactlyOnceWith(100)
  })
  it('holds every control while the next page loads', () => {
    render(<Pager label="Activity pages" page={2} pageSize={25} totalCount={60} onPage={vi.fn()} onPageSize={vi.fn()} disabled />)
    const nav = screen.getByRole('navigation', { name: 'Activity pages' })
    expect(nav).toHaveAttribute('aria-busy', 'true')
    for (const button of within(nav).getAllByRole('button')) expect(button).toBeDisabled()
    expect(within(nav).getByRole('combobox', { name: 'Rows per page' })).toBeDisabled()
  })
})

describe('loading placeholders', () => {
  it('turns on only after the delay and off at once', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 200), { initialProps: { active: true } })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(199) })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
    rerender({ active: true })
    expect(result.current).toBe(false)
  })
  it('never shows for a load that finishes first', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), { initialProps: { active: true } })
    act(() => { vi.advanceTimersByTime(150) })
    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current).toBe(false)
  })
  it('uses theme tokens only and drops the shimmer under reduced motion', () => {
    const read = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), 'utf8')
    for (const css of [read('skeleton.css'), read('pager.css')]) expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i)
    const skeleton = read('skeleton.css')
    const motion = skeleton.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(motion).toBeGreaterThan(-1)
    expect(skeleton.indexOf('animation:')).toBeGreaterThan(motion)
  })
  it('announces one status and hides the decorative bars', () => {
    render(<SkeletonStatus label="Loading plays…"><Skeleton className="skeleton-title" /><Skeleton /></SkeletonStatus>)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading plays…')
    expect(status).toHaveAttribute('aria-busy', 'true')
    for (const bar of status.querySelectorAll('[data-slot="skeleton"]')) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
