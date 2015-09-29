import _ from 'lodash'
import { expect } from 'chai'
import bitcore from 'bitcore'
import p2p from 'bitcore-p2p'

export default function (opts) {
  let request = require('./http/request')(opts)

  describe('reorg', () => {
    let savedOptions

    before(() => {
      savedOptions = opts.bitcoind.getOption('bitcoind')
      let newOptions = _.defaults({
        port: () => _.random(20000, 30000),
        rpcport: () => _.random(20000, 30000)
      }, savedOptions)
      opts.bitcoind.setOption('bitcoind', newOptions)
    })

    after(() => {
      opts.bitcoind.setOption('bitcoind', savedOptions)
    })

    it('simple', async () => {
      let otherBitcoind = await opts.bitcoind.fork({connected: false})

      try {
        await opts.bitcoind.generateBlocks(1)
        await otherBitcoind.generateBlocks(2)

        let height1 = (await opts.bitcoind.rpc.getBlockCount()).result
        let height2 = (await otherBitcoind.rpc.getBlockCount()).result
        expect(height1 + 1).to.equal(height2)

        await opts.bitcoind.connect(otherBitcoind)
        await opts.waitTextInMaster('Reorg finished')

        let latest1 = (await opts.bitcoind.rpc.getBestBlockHash()).result
        let latest2 = (await otherBitcoind.rpc.getBestBlockHash()).result
        expect(latest1).to.equal(latest2)
      } finally {
        await otherBitcoind.terminate()
      }
    })
  })

  describe.skip('orphan', () => {
    it('one tx', async () => {
      let mediumPrivKey = bitcore.PrivateKey.fromRandom('regtest')
      let walletAddresses = (await opts.bitcoind.rpc.getAddressesByAccount('')).result

      let preload = await opts.bitcoind.getPreload()

      let tx1 = new bitcore.Transaction()
        .from({
          txId: preload.txId,
          outputIndex: preload.outIndex,
          script: preload.script,
          satoshis: preload.value
        })
        .to(mediumPrivKey.toAddress(), preload.value - 1e5)
        .sign(preload.privKey)

      let tx2 = new bitcore.Transaction()
        .from({
          txId: tx1.id,
          outputIndex: 0,
          script: bitcore.Script.buildPublicKeyHashOut(mediumPrivKey.toAddress()),
          satoshis: preload.value - 1e5
        })
        .to(_.sample(walletAddresses), preload.value - 2e5)
        .sign(mediumPrivKey)

      await new Promise((resolve, reject) => {
        let peer = opts.bitcoind._peer

        let onGetData = (message) => {
          if (!(message.inventory.length === 1 &&
                message.inventory[0].type === p2p.Inventory.TYPE.TX &&
                message.inventory[0].hash.equals(tx2._getHash()))) {
            return
          }

          try {
            peer.sendMessage(peer.messages.Transaction(tx2))
            resolve()
          } catch (err) {
            reject(err)
          } finally {
            peer.removeListener('getdata', onGetData)
          }
        }
        peer.on('getdata', onGetData)

        peer.sendMessage(peer.messages.Inventory.forTransaction(tx2.id))
      })

      await require('promise-useful-utils').delay(5000)
      let result = await request.post(
        '/v2/transactions/send', {rawtx: tx1.toString()})
      expect(result).to.be.undefined

      await require('promise-useful-utils').delay(5000)
      let memPool = (await opts.bitcoind.rpc.getRawMemPool()).result
      console.log(memPool)
    })
  })
}
