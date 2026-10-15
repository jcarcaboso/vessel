/**
 * The Vessel mark: a hull riding a waterline, which also reads as a V-shaped move through a price level.
 * The part below the line is dimmed like a hull under water. Colours come from `currentColor`.
 */
export function VesselMark({ size = 24, className }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path d="M3.5 15.5h25" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M6.5 6.5 11 15.5M25.5 6.5 21 15.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M11 15.5 16 25.5 21 15.5" stroke="currentColor" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
