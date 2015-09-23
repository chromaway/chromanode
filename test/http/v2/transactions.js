import _ from 'lodash'
import { expect } from 'chai'
import { crypto, Transaction } from 'bitcore'
import PUtils from 'promise-useful-utils'

export default function (opts) {
  let request = require('../request')(opts)

  async function notFoundTest (url) {
    try {
      await request.get(url, {
        txid: crypto.Random.getRandomBuffer(32).toString('hex'),
        otxid: crypto.Random.getRandomBuffer(32).toString('hex'),
        oindex: _.random(0, 2)
      })
    } catch (err) {
      expect(err).to.be.instanceof(request.errors.StatusFail)
      expect(err.data).to.deep.equal({type: 'TxNotFound'})
    }
  }

  function hashDecode (s) {
    return Array.prototype.reverse.call(new Buffer(s, 'hex'))
  }

  describe('transactions', () => {
    describe('raw', () => {
      it('not found', _.partial(notFoundTest, '/v2/transactions/raw'))

      it('return hex', async () => {
        let blockHash = (await opts.bitcoind.rpc.getBestBlockHash()).result
        let txId = (await opts.bitcoind.rpc.getBlock(blockHash)).result.tx[0]
        let rawTx = (await opts.bitcoind.rpc.getRawTransaction(txId)).result

        let result = await request.get('/v2/transactions/raw', {txid: txId})
        expect(result).to.deep.equal({hex: rawTx})
      })
    })

    describe('merkle', () => {
      it('not found', _.partial(notFoundTest, '/v2/transactions/merkle'))

      it('tx from mempool', async () => {
        let txId = (await opts.bitcoind.generateTxs(1))[0]
        await PUtils.delay(100)
        let result = await request.get('/v2/transactions/merkle', {txid: txId})
        expect(result).to.deep.equal({source: 'mempool'})
      })

      it('return merkle', async () => {
        let height = (await opts.bitcoind.rpc.getBlockCount()).result
        let hash = (await opts.bitcoind.rpc.getBlockHash(height)).result
        let block = (await opts.bitcoind.rpc.getBlock(hash)).result
        let txIndex = _.random(0, block.tx.length - 1)

        let result = await request.get(
          '/v2/transactions/merkle', {txid: block.tx[txIndex]})
        expect(result).to.have.property('source', 'blocks')
        expect(result).to.have.deep.property('block.height', height)
        expect(result).to.have.deep.property('block.hash', hash)
        expect(result).to.have.deep.property('block.index', txIndex)

        // check merkle
        let merkle = hashDecode(block.tx[txIndex])
        for (let i = 0; i < result.block.merkle.length; i += 1) {
          let items = [merkle, hashDecode(result.block.merkle[i])]
          if ((txIndex >> i) & 1) {
            items.reverse()
          }

          merkle = crypto.Hash.sha256sha256(Buffer.concat(items))
        }
        expect(merkle.reverse().toString('hex')).to.equal(block.merkleroot)
      })
    })

    describe('spent', () => {
      it('not found', _.partial(notFoundTest, '/v2/transactions/spent'))

      it('unspent', async () => {
        let hash = (await opts.bitcoind.rpc.getBestBlockHash()).result
        let block = (await opts.bitcoind.rpc.getBlock(hash)).result

        let txId = _.sample(block.tx)
        let result = await request.get(
          '/v2/transactions/spent', {otxid: txId, oindex: 0})

        expect(result).to.deep.equal({spent: false})
      })

      it('spent', async () => {
        let hash = (await opts.bitcoind.rpc.getBlockHash(1)).result
        let txId = (await opts.bitcoind.rpc.getBlock(hash)).result.tx[0]

        let result = await request.get(
          '/v2/transactions/spent', {otxid: txId, oindex: 0})
        expect(result).to.have.property('spent', true)

        let txInfo = (await opts.bitcoind.rpc.getRawTransaction(result.itxid, 1)).result
        expect(_.pluck(txInfo.vin, 'txid')).to.include(txId)

        let txHeight = (await opts.bitcoind.rpc.getBlock(txInfo.blockhash)).result.height
        expect(txHeight).to.equal(result.iheight)
      })
    })

    describe('send', () => {
      it('bad tx', async () => {
        try {
          let rawtx = new Transaction().toString()
          await request.post('/v2/transactions/send', {rawtx: rawtx})
        } catch (err) {
          expect(err).to.be.instanceof(request.errors.StatusFail)
          expect(err.data).to.have.property('type', 'SendTxError')
        }
      })

      it('success', async () => {
        let walletAddresses = (await opts.bitcoind.rpc.getAddressesByAccount('')).result
        let preload = await opts.bitcoind.getPreload()
        let tx = new Transaction()
          .from({
            txId: preload.txId,
            outputIndex: preload.outIndex,
            satoshis: preload.value,
            script: preload.script
          })
          .to(_.sample(walletAddresses), preload.value - 1e4)
          .sign(preload.privKey)

        let result = await request.post(
          '/v2/transactions/send', {rawtx: tx.toString()})
        expect(result).to.be.undefined

        let memPool = (await opts.bitcoind.rpc.getRawMemPool()).result
        expect(memPool).to.include(tx.id)
      })
    })
  })
}
