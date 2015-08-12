var bitcore = require('bitcore')
bitcore.Networks.add({
  name: 'regtest',
  alias: 'regtest',
  pubkeyhash: 0x6f,
  privatekey: 0xef,
  scripthash: 0xc4,
  xpubkey: 0x043587cf,
  xprivkey: 0x04358394,
  networkMagic: 0xFABFB5DA,
  port: 8333,
  dnsSeeds: [ ]
})

module.exports = bitcore
