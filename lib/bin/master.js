/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var inherits = require('util').inherits
var Promise = require('bluebird')
var RpcClient = require('bitcoind-rpc')
var timers = require('timers')

var Address = bitcore.Address
var Hash = bitcore.crypto.Hash

var config = require('../config')
var logger = require('../logger').logger
var Storage = require('../storage')

/**
 * @class Master
 */
function Master () {}

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this
  return Promise.try(function () {
    // request info
    self.bitcoind = Promise.promisifyAll(new RpcClient(config.get('bitcoind')))
    return self.bitcoind.getInfoAsync()
  })
  .then(function (ret) {
    logger.info('Connected to bitcoind! (ver. %d)', ret.result.version)

    // init storage
    self.storage = new Storage()
    return self.storage.init()
  })
  .then(function () {
    return Promise.all([
      self.storage.getBestBlock(),
      self.getBitcoindBestBlock()
    ])
    .spread(function (sBestBlock, bBestBlock) {
      self.bestBlock = sBestBlock
      self.bitcoindBestBlock = bBestBlock
    })
  })
  .then(function () {
    timers.setImmediate(self.start.bind(self))
  })
}

/**
 * @return {Promise<{height: number, blockid: string}>}
 */
Master.prototype.getBitcoindBestBlock = function () {
  var self = this
  return self.bitcoind.getBlockCountAsync().then(function (ret) {
    var height = ret.result
    return self.bitcoind.getBlockHashAsync(height).then(function (ret) {
      return {height: height, blockid: ret.result}
    })
  })
}

/**
 * @param {number} height
 * @return {Promise<bitcore.Block>}
 */
Master.prototype.getBlock = function (height) {
  var self = this
  return self.bitcoind.getBlockHashAsync(height).then(function (ret) {
    return self.bitcoind.getBlockAsync(ret.result, false).then(function (ret) {
      var rawBlock = new Buffer(ret.result, 'hex')
      return new bitcore.Block(rawBlock)
    })
  })
}

/**
 * @param {pg.Client} client
 * @param {bitcore.Transaction[]} transactions
 * @param {number} [height] `undefined` for transactions in mempool
 * @return {Promise}
 */
Master.prototype.storeTransactions = function (client, transactions, height) {
  var queries = {
    blockchain: {
      storeTx: 'INSERT INTO transactions (txid, tx, height) VALUES ($1, $2, $3)',
      storeIn: 'INSERT INTO history' +
               '  (address, txid, index, prevtxid, outputindex, value, height)' +
               '  VALUES ($1, $2, $3, $4, $5, NULL, $6)',
      storeOut: 'INSERT INTO history' +
                '  (address, txid, index, prevtxid, outputindex, value, height)' +
                '  VALUES ($1, $2, $3, NULL, NULL, $4, $5)'
    },
    mempool: {
      storeTx: 'INSERT INTO transactions_mempool (txid, tx) VALUES ($1, $2)',
      storeIn: 'INSERT INTO history_mempool' +
               '  (address, txid, index, prevtxid, outputindex, value)' +
               '  VALUES ($1, $2, $3, $4, $5, NULL)',
      storeOut: 'INSERT INTO history_mempool' +
                '  (address, txid, index, prevtxid, outputindex, value)' +
                '  VALUES ($1, $2, $3, NULL, NULL, $4)'
    }
  }

  var selectAddresses = [
    'SELECT address FROM history WHERE txid = $1 AND index = $2',
    'SELECT address FROM history_mempool WHERE txid = $1 AND index = $2'
  ]

  var network = this.network
  var indexedTransactions = _.indexBy(transactions, 'id')
  var isMempool = height === undefined
  queries = isMempool ? queries.mempool : queries.blockchain

  function saveTx (tx) {
    var params = ['\\x' + tx.id, '\\x' + tx.toString()]
    if (!isMempool) { params.push(height) }
    return client.queryAsync(queries.storeTx, params)
  }

  function getInScriptAddresses (script, txid, outindex) {
    if (script.isPublicKeyHashIn()) {
      var hash = Hash.sha256ripemd160(script.chunks[1].buf)
      return Promise.resolve([new Address(hash, network, Address.PayToPublicKeyHash).toString()])
    }

    // first check current block
    var tx = indexedTransactions[txid]
    if (tx !== undefined) {
      var addresses = getOutScriptAddresses(tx.outputs[outindex].script)
      return Promise.resolve(_.invoke(addresses, 'toString'))
    }

    // load from storage
    var params = ['\\x' + txid, outindex]
    return client.queryAsync(selectAddresses[0], params)
      .then(function (res) {
        if (res.rows.length > 0) {
          return _.pluck(res.rows, 'address')
        }

        return client.queryAsync(selectAddresses[1], params)
          .then(function (res) {
            return _.pluck(res.rows, 'address')
          })
      })
  }

  function saveInputs (tx) {
    var txid = tx.id
    return tx.inputs.map(function (input, index) {
      var prevTxId = input.prevTxId.toString('hex')
      if (prevTxId === '0000000000000000000000000000000000000000000000000000000000000000' &&
          input.outputIndex === 0xffffffff) {
        return Promise.resolve()
      }

      var params = ['\\x' + txid, index, '\\x' + prevTxId, input.outputIndex]
      if (!isMempool) { params.push(height) }

      return getInScriptAddresses(input.script, prevTxId, input.outputIndex)
        .then(function (addresses) {
          return Promise.all(addresses.map(function (address) {
            var lparams = [address].concat(params)
            return client.queryAsync(queries.storeIn, lparams)
          }))
        })
    })
  }

  function getOutScriptAddresses (script) {
    if (script.isPublicKeyHashOut() && script.chunks[2].len === 20) {
      return [new Address(script.chunks[2].buf, network, Address.PayToPublicKeyHash)]
    }

    if (script.isScriptHashOut()) {
      return [new Address(script.chunks[1].buf, network, Address.PayToScriptHash)]
    }

    if (script.isMultisigOut()) {
      return script.chunks.slice(1, -2).map(function (chunk) {
        var hash = Hash.sha256ripemd160(chunk.buf)
        return new Address(hash, network, Address.PayToPublicKeyHash)
      })
    }

    if (script.isPublicKeyOut()) {
      var hash = Hash.sha256ripemd160(script.chunks[0].buf)
      return [new Address(hash, network, Address.PayToPublicKeyHash)]
    }

    return []
  }

  function saveOutputs (tx) {
    var txid = tx.id
    return tx.outputs.map(function (output, index) {
      // script validation
      try { output.script } catch (e) { return }

      var params = ['\\x' + txid, index, output.satoshis]
      if (!isMempool) { params.push(height) }

      return getOutScriptAddresses(output.script).map(function (address) {
        var lparams = [address.toString()].concat(params)
        return client.queryAsync(queries.storeOut, lparams)
      })
    })
  }

  return Promise.all(_.flattenDeep(transactions.map(function (tx) {
    return [saveTx(tx), saveInputs(tx), saveOutputs(tx)]
  })))
}

function SyncComplete () {}
inherits(SyncComplete, Error)

function ReorgFound () {}
inherits(ReorgFound, Error)

/**
 * @return {Promise}
 */
Master.prototype.catchUp = function () {
  var self = this
  var deferred = Promise.defer()
  var mempoolTruncated = false

  function tryTruncateMempool (client) {
    if (mempoolTruncated) {
      return Promise.resolve()
    }

    mempoolTruncated = true
    return client.queryAsync('TRUNCATE transactions_mempool, history_mempool')
  }

  function once () {
    return Promise.try(function () {
      // check sync status first
      if (self.bestBlock.height + 100 < self.bitcoindBestBlock.height) {
        return
      }

      // refresh bestBlock for bitcoind
      return self.getBitcoindBestBlock().then(function (bBestBlock) {
        self.bitcoindBestBlock = bBestBlock
        if (self.bestBlock.blockid === self.bitcoindBestBlock.blockid) {
          throw new SyncComplete()
        }
      })
    })
    .then(function () {
      // reorg check
      if (self.bestBlock.height >= self.bitcoindBestBlock.height) {
        logger.warn('Reorg to height: %d', self.bitcoindBestBlock.height)
        return self.storage.executeTransaction(function (client) {
          var height = self.bitcoindBestBlock.height
          return Promise.all([
            client.queryAsync('DELETE FROM blocks WHERE height >= $1', [height]),
            client.queryAsync('DELETE FROM transactions WHERE height >= $1', [height]),
            client.queryAsync('DELETE FROM history WHERE height >= $1', [height]),
            tryTruncateMempool()
          ])
        })
        .then(function () { return self.storage.getBestBlock() })
        .then(function (sBestBlock) {
          self.bestBlock = sBestBlock
          throw new ReorgFound()
        })
      }

      // get block from bitcoind
      return self.getBlock(self.bestBlock.height + 1)
    })
    .then(function (block) {
      var height = self.bestBlock.height + 1
      return self.storage.executeTransaction(function (client) {
        var blockQuery = 'INSERT INTO blocks (height, blockid, header, txids) VALUES ($1, $2, $3, $4)'

        return tryTruncateMempool(client)
          .then(function () {
            var blockValues = [
              height,
              '\\x' + block.id,
              '\\x' + block.header.toString(),
              '\\x' + _.pluck(block.transactions, 'id').join('')
            ]
            return client.queryAsync(blockQuery, blockValues)
          })
          .then(function () {
            return self.storeTransactions(client, block.transactions, height)
          })
      })
      .then(function () {
        self.bestBlock = {height: height, blockid: block.id}
        logger.verbose('Import #%d (blockId: %s)', height, block.id)
      })
    })
    .catch(ReorgFound, function () {})
    .then(function () { timers.setImmediate(once) })
    .catch(SyncComplete, function () { deferred.resolve() })
    .catch(function (err) { deferred.reject(err) })
  }

  once()

  return deferred.promise
}

/**
 * @return {Promise}
 */
Master.prototype.updateMempool = function () {
  var self = this
  return self.storage.executeTransaction(function (client) {
    return Promise.all([
      client.queryAsync('SELECT txid FROM transactions_mempool'),
      self.bitcoind.getRawMemPoolAsync()
    ])
    .spread(function (sres, bres) {
      sres = _.pluck(sres.rows, 'txid').map(function (buf) {
        return buf.toString('hex')
      })
      bres = bres.result

      var newtxs = self.bitcoind.batchAsync(function () {
        _.difference(bres, sres).map(function (txid) {
          self.bitcoind.getRawTransaction(txid)
        })
      })
      var oldtxs = _.difference(sres, bres).map(function (txid) {
        txid = '\\x' + txid
        return [
          client.queryAsync('DELETE FROM transactions_mempool WHERE txid = $1', [txid]),
          client.queryAsync('DELETE FROM history_mempool WHERE txid = $1', [txid])
        ]
      })

      return Promise.all(_.flatten(oldtxs).concat(newtxs))
        .spread(function () {
          var newtxs = _.chain(arguments)
            .last()
            .pluck('result')
            .map(bitcore.Transaction)
            .value()
          return self.storeTransactions(client, newtxs)
        })
        .then(function () {
          var diff = _.difference(bres, sres).length - oldtxs.length
          if (diff >= 0) { diff = '+' + diff.toString() }
          logger.verbose('Mempool updated... %s transactions', diff.toString())
        })
    })
  })
}

/**
 */
Master.prototype.start = function () {
  var self = this

  function once () {
    var st = Date.now()
    self.getBitcoindBestBlock().then(function (bBestBlock) {
      self.bitcoindBestBlock = bBestBlock
      if (self.bestBlock.blockid !== self.bitcoindBestBlock.blockid) {
        return self.catchUp()
      }

      return self.updateMempool()
    })
    .finally(function () {
      var et = Date.now() - st
      var delay = config.get('chromanode.updateInterval') - et
      setTimeout(once, Math.max(0, delay))
    })
  }

  logger.info('Start from %d (blockId: %s)',
              self.bestBlock.height, self.bestBlock.blockid)
  once()
}

module.exports = Master
