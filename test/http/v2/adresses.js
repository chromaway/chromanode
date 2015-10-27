import _ from 'lodash'
import { expect } from 'chai'
import bitcore from 'bitcore-lib'
import PUtils from 'promise-useful-utils'

const ZERO_HASH = new Array(65).join('0')

export default function (opts) {
  let request = require('../request')(opts)

  describe('addresses', () => {
    let addresses = []
    let transactions = []
    let unspent = []
    let latest = {}

    let heightCache = {}
    async function getHeightByTxId (txId) {
      if (heightCache[txId] === undefined) {
        let hash = (await opts.bitcoind.rpc.getRawTransaction(txId, 1)).result.blockhash
        heightCache[txId] = hash === undefined
          ? null
          : (await opts.bitcoind.rpc.getBlock(hash)).result.height
      }

      return heightCache[txId]
    }

    let txCache = {}
    async function getTx (txId) {
      if (txCache[txId] === undefined) {
        let rawtx = (await opts.bitcoind.rpc.getRawTransaction(txId)).result
        txCache[txId] = bitcore.Transaction(rawtx)
      }

      return txCache[txId]
    }

    function createAddress (script) {
      let hash = script.isPublicKeyHashOut()
        ? script.chunks[2].buf
        : bitcore.crypto.Hash.sha256ripemd160(script.chunks[0].buf)
      return new bitcore.Address(hash, 'regtest', bitcore.Address.PayToPublicKeyHash).toString()
    }

    before(async () => {
      let txIds = _.filter(await opts.bitcoind.generateTxs(10))
      do {
        await PUtils.delay(500)
        for (let txId of txIds) {
          try {
            await request.get('/v2/transactions/raw', {txid: txId})
            txIds = _.without(txIds, txId)
          } catch (err) {
            if (!(err instanceof request.errors.StatusFail)) {
              throw err
            }
          }
        }
      } while (txIds.length > 0)

      // select addresses
      let result = (await opts.bitcoind.rpc.getAddressesByAccount('')).result
      addresses = _.sample(result, 5)

      // get transactions
      result = (await opts.bitcoind.rpc.listTransactions('*', 1e6)).result
      txIds = _.unique(_.pluck(result, 'txid'))
      await PUtils.map(txIds, async (txId) => {
        let tx = await getTx(txId)
        let oAddrs = tx.outputs.map((output) => createAddress(output.script))
        let required = _.intersection(addresses, oAddrs).length > 0

        if (!required) {
          for (let input of tx.inputs) {
            let txId = input.prevTxId.toString('hex')
            if (!(txId === ZERO_HASH && input.outputIndex === 0xFFFFFFFF)) {
              let tx = await getTx(txId)
              let addr = createAddress(tx.outputs[input.outputIndex].script)
              if (addresses.includes(addr)) {
                required = true
                break
              }
            }
          }
        }

        if (required) {
          transactions.push({
            txid: txId,
            height: await getHeightByTxId(txId)
          })
        }
      }, {concurrency: 10})
      transactions = _.sortByAll(transactions, 'height', 'txid')

      // get unspent
      await PUtils.map(transactions, async (row) => {
        let tx = await getTx(row.txid)
        for (let index = 0; index < tx.outputs.length; ++index) {
          let output = tx.outputs[index]
          let address = createAddress(output.script)
          if (addresses.includes(address)) {
            let txOut = await opts.bitcoind.rpc.getTxOut(row.txid, index, true)
            if (txOut.result !== null) {
              unspent.push({
                txid: row.txid,
                vount: index,
                value: output.satoshis,
                script: output.script.toHex(),
                height: row.height
              })
            }
          }
        }
      }, {concurrency: 10})
      unspent = _.sortByAll(unspent, 'height', 'txid', 'vount')

      // get latest
      latest = {
        height: (await opts.bitcoind.rpc.getBlockCount()).result,
        hash: (await opts.bitcoind.rpc.getBestBlockHash()).result
      }
    })

    it('only addresses', async () => {
      let result = await request.get(
        '/v2/addresses/query', {addresses: addresses})
      expect(result).to.be.an('Object')

      let sortedResult = {
        transactions: _.sortByAll(result.transactions, 'height', 'txid'),
        latest: result.latest
      }
      expect(sortedResult).to.deep.equal({transactions: transactions, latest: latest})

      delete result.transactions
      delete result.latest
      expect(result).to.deep.equal({})
    })

    it('get unspent', async () => {
      let result = await request.get(
        '/v2/addresses/query', {addresses: addresses, status: 'unspent'})
      expect(result).to.be.an('Object')

      let sortedResult = {
        unspent: _.sortByAll(result.unspent, 'height', 'txid', 'vount'),
        latest: result.latest
      }
      expect(sortedResult).to.deep.equal({unspent: unspent, latest: latest})

      delete result.unspent
      delete result.latest
      expect(result).to.deep.equal({})
    })

    it('source mempool', async () => {
      let result = await request.get(
        '/v2/addresses/query', {addresses: addresses, source: 'mempool'})
      expect(result).to.be.an('Object')
      expect(result.latest).to.deep.equal(latest)

      let sorted = _.sortByAll(result.transactions, 'height', 'txid')
      expect(sorted).to.deep.equal(_.filter(transactions, {height: null}))

      delete result.transactions
      delete result.latest
      expect(result).to.deep.equal({})
    })

    it('from not default', async () => {
      let from = _.chain(transactions).pluck('height').filter().first().value()

      let result = await request.get(
        '/v2/addresses/query', {addresses: addresses, from: from})
      expect(result).to.be.an('Object')
      expect(result.latest).to.deep.equal(latest)

      let sorted = _.sortByAll(result.transactions, 'height', 'txid')
      expect(sorted).to.deep.equal(transactions.filter((row) => {
        return row.height === null || row.height > from
      }))

      delete result.transactions
      delete result.latest
      expect(result).to.deep.equal({})
    })

    it('to not default', async () => {
      let to = _.chain(transactions).pluck('height').filter().last().value() - 1

      let result = await request.get(
        '/v2/addresses/query', {addresses: addresses, to: to})
      expect(result).to.be.an('Object')
      expect(result.latest).to.deep.equal(latest)

      let sorted = _.sortByAll(result.transactions, 'height', 'txid')
      expect(sorted).to.deep.equal(transactions.filter((row) => {
        return row.height === null || row.height <= to
      }))

      delete result.transactions
      delete result.latest
      expect(result).to.deep.equal({})
    })
  })
}
