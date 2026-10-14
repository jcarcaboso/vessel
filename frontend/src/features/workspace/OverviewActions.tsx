import { DropdownMenu } from 'radix-ui'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function OverviewActions({ disabled, onNewPlay, onPortfolio, onAccount }: {
  disabled: boolean; onNewPlay: () => void; onPortfolio: () => void; onAccount: () => void
}) {
  return <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><Button variant="outline" disabled={disabled}><Plus size={15} />Add<ChevronDown size={14} /></Button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="overview-add-menu" align="end" sideOffset={6} aria-label="Add to workspace">
        <DropdownMenu.Item onSelect={onAccount}>Add account</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={onPortfolio}>New portfolio</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    <Button onClick={onNewPlay} disabled={disabled}><Plus size={15} />New play</Button>
  </>
}
