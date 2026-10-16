/** Rows-per-page choices shared by every paged list. Overview asks the API for 5 without offering a selector. */
export const pageSizes = [25, 50, 100] as const
export type PageSize = typeof pageSizes[number]
export const defaultPageSize: PageSize = 25
export const isPageSize = (value: unknown): value is PageSize => pageSizes.includes(value as PageSize)

export const pageCount = (totalCount: number, pageSize: number) => Math.max(1, Math.ceil(totalCount / pageSize))

export type PageItem = number | 'gap-start' | 'gap-end'
/** The first and last page, the current page and its neighbours; a single missing page is shown instead of an ellipsis. */
export function pageItems(page: number, count: number): PageItem[] {
  const wanted = [...new Set([1, page - 1, page, page + 1, count])].filter(n => n >= 1 && n <= count).sort((a, b) => a - b)
  const items: PageItem[] = []
  for (const n of wanted) {
    const previous = items.at(-1)
    if (typeof previous === 'number' && n - previous === 2) items.push(n - 1)
    else if (typeof previous === 'number' && n - previous > 2) items.push(previous === 1 ? 'gap-start' : 'gap-end')
    items.push(n)
  }
  return items
}
