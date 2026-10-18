/**
 * EIP-55 mixed-case checksum for showing an EVM address the same way everywhere (wallets often share it in lower
 * case, the server writes the checksum form). Display only: comparisons stay case-insensitive (`sameAddress`).
 */

const mask = (1n << 64n) - 1n
const rounds = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]
// Rotation of lane x + 5y.
const offsets = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]
const rotate = (value: bigint, by: number) => by === 0 ? value : ((value << BigInt(by)) | (value >> BigInt(64 - by))) & mask

function permute(state: bigint[]) {
  for (const constant of rounds) {
    const c = Array.from({ length: 5 }, (_, x) => state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!)
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotate(c[(x + 1) % 5]!, 1)
      for (let y = 0; y < 25; y += 5) state[x + y]! ^= d
    }
    const b = new Array<bigint>(25)
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(state[x + 5 * y]!, offsets[x + 5 * y]!)
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      state[x + 5 * y] = b[x + 5 * y]! ^ (~b[(x + 1) % 5 + 5 * y]! & mask & b[(x + 2) % 5 + 5 * y]!)
    state[0] = state[0]! ^ constant
  }
}

/** Keccak-256 (the original padding Ethereum uses, not SHA3-256) of `bytes`, as lower-case hex. */
export function keccak256(bytes: Uint8Array): string {
  const rate = 136
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate)
  padded.set(bytes)
  padded[bytes.length]! ^= 0x01
  padded[padded.length - 1]! ^= 0x80
  const state = new Array<bigint>(25).fill(0n)
  for (let block = 0; block < padded.length; block += rate) {
    for (let lane = 0; lane < rate / 8; lane++) {
      let value = 0n
      for (let byte = 7; byte >= 0; byte--) value = (value << 8n) | BigInt(padded[block + lane * 8 + byte]!)
      state[lane] = state[lane]! ^ value
    }
    permute(state)
  }
  let hex = ''
  for (let lane = 0; lane < 4; lane++) for (let byte = 0; byte < 8; byte++) hex += Number((state[lane]! >> BigInt(byte * 8)) & 0xffn).toString(16).padStart(2, '0')
  return hex
}

/** The checksum form of a `0x` + 40 hex address; anything else comes back unchanged. */
export function checksumAddress(address: string): string {
  if (!/^0x[\da-fA-F]{40}$/.test(address)) return address
  const lower = address.slice(2).toLowerCase()
  const hash = keccak256(new TextEncoder().encode(lower))
  let result = '0x'
  for (let index = 0; index < 40; index++) result += parseInt(hash[index]!, 16) >= 8 ? lower[index]!.toUpperCase() : lower[index]!
  return result
}
