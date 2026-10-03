import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi, type BrokerAccount, type WorkspaceApi } from '@/api/workspace'
import type { PlayExecution, PlayFields, PlayHistory, PlayStatus, PlaySummary, SavedEvidence, SavedPlay, StatusRequest } from '@/api/plays'
import { ApiError } from '@/api/system'
import { accountFixture, idleMarketStream, instrumentCatalogFixture, portfolioFixture } from '@/test/workspace-fixture'
import { PlaysPage } from './PlaysPage'
import { createDraft } from './draft'
import { createPlaysSession, describePlanChanges, planFromDraft, syncEvidence, type PlaysSession } from './saved'

const ids = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** An in-memory stand-in for the saved-play API with the server's version and revision rules. */
function fakeServer() {
  let next = 1
  const plays = new Map<string, SavedPlay>()
  const history = new Map<string, PlayHistory>()
  const evidence: SavedEvidence[] = []
  const now = () => '2026-10-03T10:00:00.000Z'
  const bump = (play: SavedPlay, changes: Partial<PlaySummary> = {}) =>
    ({ ...play, summary: { ...play.summary, ...changes, version: play.summary.version + 1, updatedAtUtc: now() } })
  const find = (id: string) => {
    const play = plays.get(id)
    if (!play) throw new ApiError('http', 'This play or image is no longer available.', 404)
    return play
  }
  const execution = (play: SavedPlay): PlayExecution => ({
    playId: play.summary.id, status: play.summary.status, tracked: play.summary.instrumentSource === 'venue', checkedAtUtc: null,
    reason: play.summary.instrumentSource === 'venue' ? null : 'Manual instruments are not tracked at a venue.',
    totals: { enteredQuantity: '0', exitedQuantity: '0', openQuantity: '0', closedPnlUsd: '0', fees: [] },
    entries: [], links: [], suggestions: [], unlinkedOrders: [], notice: 'Venue facts.',
  })
  const api = {
    plays: vi.fn(() => Promise.resolve([...plays.values()].map(play => play.summary))),
    play: vi.fn((id: string) => Promise.resolve(find(id))),
    createPlay: vi.fn((fields: PlayFields) => {
      const id = ids(next++)
      const play: SavedPlay = {
        summary: { id, title: fields.title.trim(), status: 'draft', accountId: fields.accountId, venueId: 'manual', instrument: fields.instrument,
          instrumentSource: fields.instrumentSource, direction: fields.plan.direction, planRevision: 0, version: 1, cancelReason: null,
          createdAtUtc: now(), updatedAtUtc: now(), plannedAtUtc: null, endedAtUtc: null },
        plan: fields.plan, drawings: fields.drawings, review: fields.review,
      }
      plays.set(id, play)
      history.set(id, { revisions: [], statusChanges: [] })
      return Promise.resolve(play)
    }),
    updatePlay: vi.fn((id: string, fields: PlayFields & { expectedVersion: number; revisionReason?: string }) => {
      const play = find(id)
      if (play.summary.version !== fields.expectedVersion) return Promise.reject(new ApiError('http', 'This Play changed elsewhere.', 409))
      const planChanged = JSON.stringify(play.plan) !== JSON.stringify(fields.plan)
      let revision = play.summary.planRevision
      if (planChanged && play.summary.status !== 'draft') {
        if (!fields.revisionReason) return Promise.reject(new ApiError('http', 'Say why the plan changed.', 409))
        revision += 1
        history.get(id)!.revisions.push({ number: revision, status: play.summary.status, reason: fields.revisionReason, createdAtUtc: now(), plan: fields.plan })
      }
      const updated = { ...bump(play, { title: fields.title.trim(), instrument: fields.instrument, planRevision: revision }),
        plan: fields.plan, drawings: fields.drawings, review: fields.review }
      plays.set(id, updated)
      return Promise.resolve(updated)
    }),
    changePlayStatus: vi.fn((id: string, version: number, request: StatusRequest) => {
      const play = find(id)
      if (play.summary.version !== version) return Promise.reject(new ApiError('http', 'This Play changed elsewhere.', 409))
      const to: PlayStatus = request.status
      const record = history.get(id)!
      record.statusChanges.push({ from: play.summary.status, to, reason: request.status === 'cancelled' ? request.reason : null,
        note: request.status === 'cancelled' ? request.note ?? null : null, occurredAtUtc: now() })
      const planned = play.summary.status === 'draft' && to === 'planned'
      if (planned) record.revisions.push({ number: 1, status: 'planned', reason: 'Planned', createdAtUtc: now(), plan: play.plan })
      const updated = bump(play, { status: to, ...(planned ? { planRevision: 1, plannedAtUtc: now() } : {}),
        ...(request.status === 'cancelled' ? { cancelReason: request.reason, endedAtUtc: now() } : {}) })
      plays.set(id, updated)
      return Promise.resolve(updated)
    }),
    playHistory: vi.fn((id: string) => Promise.resolve(history.get(id)!)),
    deletePlay: vi.fn((id: string) => { plays.delete(id); return Promise.resolve() }),
    evidence: vi.fn((playId: string) => Promise.resolve(evidence.filter(item => item.playId === playId))),
    evidenceImage: vi.fn(() => Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))),
    uploadEvidence: vi.fn((playId: string, _image: Blob, fields: { source: 'capture' | 'upload'; note: string }) => {
      const item: SavedEvidence = { id: ids(1000 + next++), playId, source: fields.source, contentType: 'image/png', sizeBytes: 4,
        sha256: 'a'.repeat(64), note: fields.note, createdAtUtc: now(), updatedAtUtc: now(), markup: null }
      evidence.push(item)
      return Promise.resolve(item)
    }),
    updateEvidenceNote: vi.fn((id: string, note: string) => {
      const item = evidence.find(other => other.id === id)!
      item.note = note
      return Promise.resolve({ ...item })
    }),
    updateEvidenceMarkup: vi.fn(),
    playExecution: vi.fn((id: string) => Promise.resolve(execution(find(id)))),
    checkPlayExecution: vi.fn((id: string) => Promise.resolve(execution(find(id)))),
    deleteEvidence: vi.fn((id: string) => { evidence.splice(evidence.findIndex(item => item.id === id), 1); return Promise.resolve() }),
  }
  return { api, plays, history, evidence, execution }
}

function Page({ api, accounts = [accountFixture], initial = createPlaysSession() }: { api: WorkspaceApi; accounts?: BrokerAccount[]; initial?: PlaysSession }) {
  const [session, setSession] = useState(initial)
  return <PlaysPage accounts={accounts} portfolios={[portfolioFixture]} api={api} session={session} onSession={setSession} />
}

const client = (server: ReturnType<typeof fakeServer>, overrides: Partial<WorkspaceApi> = {}) =>
  ({ ...createWorkspaceApi('test-only'), ...server.api, marketStream: idleMarketStream, ...overrides }) as unknown as WorkspaceApi

async function newPlannedPlay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New play' }))
  await user.type(screen.getByRole('textbox', { name: 'Play title' }), '  Range reclaim')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
  expect(screen.getByRole('button', { name: 'Plan it' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Perpetual instrument' }), 'BTC-PERP')
  await user.type(screen.getByRole('spinbutton', { name: 'Entry 1 planned entry price (quote units)' }), '100')
  await user.type(screen.getByRole('spinbutton', { name: 'Entry 1 planned stop price (quote units)' }), '95')
  await user.click(screen.getByRole('button', { name: 'Plan it' }))
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Play draft workspace' })).getByText('Planned', { selector: '.badge' })).toBeInTheDocument())
}

describe('saved plays', () => {
  it('saves a new draft, plans it and fixes the account and instrument', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server)} />)
    await screen.findByText(/No saved plays yet/)
    await newPlannedPlay(user)
    expect(server.api.createPlay).toHaveBeenCalledOnce()
    expect(server.api.createPlay.mock.calls[0]![0]).toMatchObject({ accountId: accountFixture.id, instrument: 'BTC-PERP', instrumentSource: 'manual' })
    expect(server.api.changePlayStatus).toHaveBeenCalledWith(ids(1), 1, { status: 'planned' })
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Range reclaim')
    expect(screen.getByRole('combobox', { name: 'Account' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /Saved/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('asks why a planned plan changed and keeps each revision', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server)} />)
    await newPlannedPlay(user)
    const stop = screen.getByRole('spinbutton', { name: 'Entry 1 planned stop price (quote units)' })
    await user.clear(stop)
    await user.type(stop, '97')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    const dialog = screen.getByRole('dialog', { name: 'Why did the plan change?' })
    expect(within(dialog).getByRole('button', { name: 'Save revision' })).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Stop under the new swing low')
    await user.click(within(dialog).getByRole('button', { name: 'Save revision' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.api.updatePlay.mock.lastCall![1]).toMatchObject({ revisionReason: 'Stop under the new swing low', expectedVersion: 2 })
    expect(screen.getByRole('status')).toHaveTextContent('revision 2')

    // A title change alone is saved without a reason.
    await user.type(screen.getByRole('textbox', { name: 'Play title' }), ' v2')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(server.api.updatePlay).toHaveBeenCalledTimes(2))
    expect(server.api.updatePlay.mock.lastCall![1]).not.toHaveProperty('revisionReason')

    await user.click(screen.getByRole('button', { name: 'History' }))
    const history = await screen.findByRole('dialog', { name: 'Play history' })
    expect(await within(history).findByText('Plan revision 2 · Stop under the new swing low')).toBeInTheDocument()
    expect(within(history).getByText('Entry 1 stop: 95 → 97')).toBeInTheDocument()
    expect(within(history).getByText('Draft → Planned')).toBeInTheDocument()
  })

  it('pauses, resumes and cancels with a reason, leaving only the review editable', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server)} />)
    await newPlannedPlay(user)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(await screen.findByRole('button', { name: 'Resume' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel play' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel this play?' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Reason' }), 'missed')
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Price ran away')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel play' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.api.changePlayStatus.mock.lastCall![2]).toEqual({ status: 'cancelled', reason: 'missed', note: 'Price ran away' })
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled. The plan is kept')
    expect(screen.getByRole('spinbutton', { name: 'Entry 1 planned entry price (quote units)' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Play title' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Thesis' }))
    expect(screen.getByRole('textbox', { name: 'Thesis' })).toHaveAttribute('readonly')
    await user.click(screen.getByRole('tab', { name: 'Review' }))
    await user.type(screen.getByRole('textbox', { name: 'Review' }), 'Waited too long.')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(server.api.updatePlay.mock.lastCall![1]).toMatchObject({ review: 'Waited too long.' }))
  })

  it('lists saved plays, keeps unsaved edits through navigation and blocks opening another play until resolved', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server)} />)
    await user.click(await screen.findByRole('button', { name: 'New play' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    await user.type(screen.getByRole('textbox', { name: 'Play title' }), 'First')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(server.api.createPlay).toHaveBeenCalledOnce())
    await user.type(screen.getByRole('textbox', { name: 'Play title' }), ' edited')
    await user.click(screen.getByRole('button', { name: 'All plays' }))

    expect(await screen.findByText(/Unsaved changes in/)).toHaveTextContent('First edited')
    const open = await screen.findByRole('button', { name: 'Open First' })
    expect(open).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New play' })).toBeDisabled()
    expect(within(open).getByText('Draft')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Closed and cancelled' }))
    expect(screen.getByText('No plays in this view.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'In progress' }))

    await user.click(screen.getByRole('button', { name: 'Continue editing' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('First edited')
    await user.click(screen.getByRole('button', { name: 'All plays' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await user.click(await screen.findByRole('button', { name: 'Open First' }))
    expect(await screen.findByRole('textbox', { name: 'Play title' })).toHaveValue('First')
    expect(screen.getByRole('button', { name: /Saved/ })).toBeDisabled()
  })

  it('deletes only drafts', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server)} />)
    await user.click(await screen.findByRole('button', { name: 'New play' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete draft' }))
    await screen.findByText(/No saved plays yet/)
    expect(server.api.deletePlay).toHaveBeenCalledWith(ids(1))
  })

  it('shows save failures without losing the draft', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server, { createPlay: vi.fn().mockRejectedValue(new ApiError('http', 'Enable the account before using it for a Play.', 409)) })} />)
    await user.click(await screen.findByRole('button', { name: 'New play' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    await user.type(screen.getByRole('textbox', { name: 'Play title' }), 'Kept')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enable the account before using it for a Play.')
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Kept')
  })

  it('links a venue instrument to its trading page on the venue', async () => {
    const venue = { ...accountFixture, venueId: 'hyperliquid', address: `0x${'a'.repeat(40)}` }
    const server = fakeServer()
    const user = userEvent.setup()
    render(<Page api={client(server, { instruments: () => Promise.resolve(instrumentCatalogFixture), candles: () => new Promise(() => {}),
      marketContext: () => new Promise(() => {}) })} accounts={[venue]} />)
    await user.click(await screen.findByRole('button', { name: 'New play' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), venue.id)
    expect(screen.queryByRole('link', { name: /on Hyperliquid/ })).not.toBeInTheDocument()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Perpetual instrument' }), 'BTC')
    const link = screen.getByRole('link', { name: 'Open BTC on Hyperliquid' })
    expect(link).toHaveAttribute('href', 'https://app.hyperliquid.xyz/trade/BTC')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('venue tracking', () => {
  it('checks a tracked play when opened and takes the status that linked fills produced', async () => {
    const server = fakeServer()
    const venue = { ...accountFixture, venueId: 'hyperliquid', address: `0x${'a'.repeat(40)}` }
    const api = client(server, { instruments: () => Promise.resolve(instrumentCatalogFixture), candles: () => new Promise(() => {}),
      marketContext: () => new Promise(() => {}) })
    const user = userEvent.setup()
    render(<Page api={api} accounts={[venue]} />)
    await user.click(await screen.findByRole('button', { name: 'New play' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), venue.id)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Perpetual instrument' }), 'BTC')
    await user.type(screen.getByRole('spinbutton', { name: 'Entry 1 planned entry price (quote units)' }), '100')
    // The venue reports the entry filled: the server moves the play to Open on the next check.
    server.api.checkPlayExecution.mockImplementation((id: string) => {
      const play = server.plays.get(id)!
      const opened = { ...play, summary: { ...play.summary, status: 'open' as const, version: play.summary.version + 1 } }
      server.plays.set(id, opened)
      return Promise.resolve(server.execution(opened))
    })
    await user.click(screen.getByRole('button', { name: 'Plan it' }))
    await waitFor(() => expect(server.api.checkPlayExecution).toHaveBeenCalled())
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Play draft workspace' })).getByText('Open', { selector: '.badge' })).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'Execution' }))
    expect(screen.getByRole('button', { name: 'Check venue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })
})

describe('saved play helpers', () => {
  it('describes plan revisions by entry and target identity', () => {
    const draft = createDraft()
    const before = planFromDraft({ ...draft, entries: [{ ...draft.entries[0]!, price: '100', stop: { ...draft.entries[0]!.stop, value: '95' } }] })
    const entry = before.entries[0]!
    const after = { ...before, leverage: '5', entries: [{ ...entry, stop: { ...entry.stop, unit: 'percent' as const, value: '3' },
      targets: [{ ...entry.targets[0]!, value: '110' }, { id: 't2', unit: 'price' as const, value: '120', share: '50' }] }],
      notes: { ...before.notes, thesis: 'Changed' } }
    expect(describePlanChanges(before, after)).toEqual([
      'Leverage: 1× → 5×', 'Entry 1 stop: 95 → 3%', 'Entry 1 target 1: blank → 110', 'Entry 1 target 2 added at 120', 'Thesis edited',
    ])
    expect(describePlanChanges(after, { ...after, entries: [] })).toEqual(['Entry 1 removed'])
  })

  it('syncs evidence: deletes removed images, uploads new ones and saves edited notes, then stops at a failure', async () => {
    const server = fakeServer()
    const api = client(server)
    const image = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const kept = { id: 'k', serverId: ids(1), savedState: { note: 'old', markup: null }, source: 'upload' as const, image, name: 'a.png', context: '', note: 'new', markup: null, addedAt: '' }
    const fresh = { id: 'f', source: 'capture' as const, image, name: 'b.png', context: '', note: 'capture', markup: null, addedAt: '' }
    server.evidence.push({ id: ids(1), playId: ids(9), source: 'upload', contentType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64), note: 'old', createdAtUtc: '', updatedAtUtc: '', markup: null },
      { id: ids(2), playId: ids(9), source: 'upload', contentType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64), note: '', createdAtUtc: '', updatedAtUtc: '', markup: null })
    const result = await syncEvidence(api, ids(9), [kept, fresh], [ids(1), ids(2)])
    expect(result.error).toBeNull()
    expect(server.api.deleteEvidence).toHaveBeenCalledWith(ids(2))
    expect(server.api.updateEvidenceNote).toHaveBeenCalledWith(ids(1), 'new')
    expect(result.evidence[1]).toMatchObject({ id: 'f', savedState: { note: 'capture' } })
    expect(result.evidence[1]!.serverId).toBeTruthy()

    const failing = client(server, { deleteEvidence: vi.fn().mockRejectedValue(new ApiError('unavailable', 'Down')) })
    const failed = await syncEvidence(failing, ids(9), [fresh], [ids(1)])
    expect(failed.error).toBeInstanceOf(ApiError)
    expect(failed.pendingDeletes).toEqual([ids(1)])
    expect(failed.evidence[0]!.serverId).toBeUndefined()
  })
})
