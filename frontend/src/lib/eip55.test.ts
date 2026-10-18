import { describe, expect, it } from 'vitest'
import { checksumAddress, keccak256 } from './eip55'

const text = (value: string) => new TextEncoder().encode(value)

describe('EIP-55 display', () => {
  it('hashes with Keccak-256, including a message longer than one block', () => {
    expect(keccak256(text(''))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(keccak256(text('abc'))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
    expect(keccak256(text('a'.repeat(200)))).toHaveLength(64)
  })

  // The test vectors of EIP-55 itself.
  it.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ])('restores %s from lower or upper case', address => {
    expect(checksumAddress(address.toLowerCase())).toBe(address)
    expect(checksumAddress(`0x${address.slice(2).toUpperCase()}`)).toBe(address)
  })

  it('leaves anything that is not an EVM address unchanged', () => {
    expect(checksumAddress('12345')).toBe('12345')
    expect(checksumAddress('0x123')).toBe('0x123')
  })
})
