// Disposable checks only. These publicly known keys must NEVER hold funds.
// Dependencies live outside the application checkout (NOBLE_MODULE_DIR).
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function signer(index) {
  assert.equal(process.env.VESSEL_RELEASE_SYNTHETIC, '1', 'Synthetic services only')
  assert.ok(Number.isInteger(index) && index >= 1 && index <= 20)
  const root = process.env.NOBLE_MODULE_DIR
  assert.ok(root && path.isAbsolute(root), 'NOBLE_MODULE_DIR must be an absolute external node_modules directory')
  const { secp256k1 } = await import(pathToFileURL(path.join(root, '@noble/curves/secp256k1.js')))
  const { keccak_256 } = await import(pathToFileURL(path.join(root, '@noble/hashes/sha3.js')))
  const key = Uint8Array.from(Buffer.from(index.toString(16).padStart(64, '0'), 'hex'))
  const publicKey = secp256k1.getPublicKey(key, false)
  const address = '0x' + Buffer.from(keccak_256(publicKey.slice(1))).subarray(-20).toString('hex')
  return {
    address,
    sign(message) {
      assert.equal(typeof message, 'string')
      const bytes = Buffer.from(message, 'utf8')
      const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, 'utf8')
      const digest = keccak_256(Buffer.concat([prefix, bytes]))
      // Noble v2 recovered format is recovery byte || r || s; Ethereum uses r || s || (27 + recovery).
      const signature = secp256k1.sign(digest, key, { prehash: false, format: 'recovered' })
      return '0x' + Buffer.concat([Buffer.from(signature.slice(1)), Buffer.from([27 + signature[0]])]).toString('hex')
    },
  }
}

module.exports = { signer }
if (require.main === module) {
  let input = ''
  process.stdin.setEncoding('utf8').on('data', chunk => { input += chunk }).on('end', async () => {
    try {
      const request = JSON.parse(input)
      const wallet = await signer(request.wallet)
      console.log(JSON.stringify({ address: wallet.address, ...request.message ? { signature: wallet.sign(request.message) } : {} }))
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  })
}
