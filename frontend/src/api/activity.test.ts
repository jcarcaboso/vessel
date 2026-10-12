import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from './workspace'
import { activityFixture, operationFixture } from '@/test/activity-fixture'
import { accountFixture } from '@/test/workspace-fixture'

function response(value: unknown) { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }))) }
afterEach(() => vi.unstubAllGlobals())

describe('activity API', () => {
  it('preserves exact strings, authenticates and requests the account scope', async () => {
    response(activityFixture)
    const document = await createWorkspaceApi('secret-test-token').activity(accountFixture.id)
    expect(document).toEqual(activityFixture)
    expect(document.operations[0]!.averageEntryPrice).toBe('100.123456789123456789')
    expect(fetch).toHaveBeenCalledWith(`/api/activity?accountId=${accountFixture.id}`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-test-token' }) }))
  })
  it.each(Object.keys(operationFixture))('rejects a missing operation field %s', async key => {
    const document = structuredClone(activityFixture)
    delete (document.operations[0] as unknown as Record<string, unknown>)[key]
    response(document)
    await expect(createWorkspaceApi('token').activity()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it.each([
    { quantity: 2 }, { direction: 'buy' }, { status: 'planned' }, { averageEntryPrice: '1e3' }, { entryOrderCount: 1.5 },
    { netResultUsd: 0.1 }, { pnlBasis: 'guess' }, { playAssociation: 'linked', playId: null }, { otherFees: [{ token: 'ETH', amount: 1 }] },
    { coverage: [null] }, { openedAtUtc: 'yesterday' }, { closedAtUtc: '2026-10-12T11:00:00Z' }, { omittedFillCount: 1 },
    { direction: null }, { fills: [{ ...operationFixture.fills[0]!, role: 'flip' }] },
    { fills: [{ ...operationFixture.fills[0]!, fill: { ...operationFixture.fills[0]!.fill, accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }] },
  ])('rejects malformed or contradictory fields %j', async fields => {
    response({ ...activityFixture, operations: [{ ...operationFixture, ...fields }] })
    await expect(createWorkspaceApi('token').activity()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('accepts incomplete coverage and unknown values without inventing an entry', async () => {
    const incomplete = { ...operationFixture, status: 'incomplete', direction: null, openedAtUtc: null, quantity: null, totalEnteredQuantity: null,
      totalExitedQuantity: null, openQuantity: null, averageEntryPrice: null, averageExitPrice: null, coverage: ['Opening history missing.'] }
    response({ ...activityFixture, operations: [incomplete] })
    await expect(createWorkspaceApi('token').activity()).resolves.toMatchObject({ operations: [{ direction: null, quantity: null }] })
  })
  it('rejects missing document fields, foreign coverage identities and duplicated operations', async () => {
    for (const key of Object.keys(activityFixture)) {
      const document = structuredClone(activityFixture); delete (document as unknown as Record<string, unknown>)[key]; response(document)
      await expect(createWorkspaceApi('token').activity()).rejects.toMatchObject({ kind: 'invalid-response' })
    }
    response({ ...activityFixture, coverage: [{ accountId: 'invalid', contractId: null, notice: 'Missing' }] })
    await expect(createWorkspaceApi('token').activity()).rejects.toMatchObject({ kind: 'invalid-response' })
    response({ ...activityFixture, totalOperationCount: 2, operations: [operationFixture, operationFixture] })
    await expect(createWorkspaceApi('token').activity()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects a response for another account and accepts case-insensitive GUID requests', async () => {
    response(activityFixture)
    await expect(createWorkspaceApi('token').activity('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rejects.toMatchObject({ kind: 'invalid-response' })
    response(activityFixture)
    await expect(createWorkspaceApi('token').activity(accountFixture.id.toUpperCase())).resolves.toEqual(activityFixture)
  })
  it('rejects invalid account ids without making requests', () => {
    response(activityFixture)
    expect(() => createWorkspaceApi('token').activity('../../private')).toThrow('identifier')
    expect(() => createWorkspaceApi('token').activity('')).toThrow('identifier')
    expect(fetch).not.toHaveBeenCalled()
  })
})
