import type { ReactNode } from 'react'

/**
 * Drawing tool icons in the style of common charting tools: thin strokes with anchor dots where a tool
 * has anchors. 18 px, current color.
 */
function icon(...children: ReactNode[]) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children.map((child, index) => <g key={index}>{child}</g>)}</svg>
}

const dot = (x: number, y: number) => <circle cx={x} cy={y} r="1.7" fill="var(--card, #111)" />

export const toolIcons = {
  crosshair: icon(<><path d="M9 2v5M9 11v5M2 9h5M11 9h5" /></>),
  trendLine: icon(<><path d="M5 13 13 5" />{dot(4, 14)}{dot(14, 4)}</>),
  horizontalLine: icon(<><path d="M2 9h5.3M10.7 9H16" />{dot(9, 9)}</>),
  verticalLine: icon(<><path d="M9 2v5.3M9 10.7V16" />{dot(9, 9)}</>),
  rectangle: icon(<><rect x="3.5" y="5" width="11" height="8" rx=".5" />{dot(3.5, 5)}{dot(14.5, 13)}</>),
  fibonacci: icon(<><path d="M3 4h12M3 7.5h12M3 10.5h12M3 14h12" /><path d="M4 14 14 4" strokeDasharray="1.6 1.6" /></>),
  longPosition: icon(<><rect x="3" y="3" width="12" height="12" rx=".5" /><path d="M3 10.5h12" /><path d="M9 8.5V4.8M7.3 6.4 9 4.7l1.7 1.7" /></>),
  shortPosition: icon(<><rect x="3" y="3" width="12" height="12" rx=".5" /><path d="M3 7.5h12" /><path d="M9 9.5v3.7M7.3 11.6 9 13.3l1.7-1.7" /></>),
  priceRange: icon(<><path d="M4 3h10M4 15h10M9 5v8M7.3 6.7 9 5l1.7 1.7M7.3 11.3 9 13l1.7-1.7" /></>),
  dateRange: icon(<><path d="M3 4v10M15 4v10M5 9h8M6.7 7.3 5 9l1.7 1.7M11.3 7.3 13 9l-1.7 1.7" /></>),
  text: icon(<><path d="M4 4.5h10M9 4.5V15M7 15h4" /></>),
} as const
