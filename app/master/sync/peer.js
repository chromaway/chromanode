/* globals Promise:true */

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')

var errors = require('../../../lib/errors')
var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('./sql')

// fake error
function TransactionsAlreadyExists () {}
inherits(TransactionsAlreadyExists, Error)

/**
 * @class PeerSync
 * @extends Sync
 */
function PeerSync () {
  Sync.apply(this, arguments)
}

inherits(PeerSync, Sync)

/**
 * @return {Promise}
 */
PeerSync.prototype._updateChain = function () {
  return

  var self = this
  if (self._latest.hash === self._blockchainLatest.hash) {
    return
  }

  // todo
  // delete postgres_mempool - bitcoind_mempool
  // add block - postgres_mempool
  // update height for block transactions
  // add bitcoind_mempool - block - postgres_mempool as unconfirmed
  var stopwatch
  var latest = _.clone(self._latest)
  return self._storage.executeTransaction(function (client) {
    return Promise.try(function () {
      if (latest.height + 1 < self._blockchainLatest.height) {
        return
      }

      // reorg found
      var to = self._blockchainLatest.height - 1
      return self._reorgTo(to, {client: client})
        .then(function () {
          return self._getMyLatest({client: client})
        })
        .then(function (newLatest) {
          latest = newLatest
        })
    })
    .then(function () {
      return self._getBlock(latest.height + 1)
    })
    .then(function (block) {
      // check hashPrevBlock
      if (latest.hash !== util.encode(block.header.prevHash)) {
        throw new errors.Master.InvalidHashPrevBlock(latest.hash, block.hash)
      }

      stopwatch = util.stopwatch.start()
      return self._importBlock(latest.height + 1, block, client)
    })
    .then(function () {
      stopwatch = stopwatch.value()
      return self._getMyLatest({client: client})
    })
  })
  .then(function (newLatest) {
    // new latest
    self._latest = newLatest

    // verbose logging
    logger.verbose('Import block #%d, elapsed time: %s (hash: %s)',
                   self._latest.height,
                   util.stopwatch.format(stopwatch),
                   self._latest.hash)

    // update self._progress and emit progress if need
    self._updateProgress()

    // fill block cache
    if (self._latest.height + 500 < self._blockchainLatest.height) {
      var start = self._latest.height + 1
      var stop = self._latest.height + self._maxCachedBlocks + 1
      _.range(start, stop).forEach(function (height, index) {
        setTimeout(function () { self._getBlock(height) }, index)
      })
    }

    // run _loop again
    timers.setImmediate(self._loop.bind(self))
  })
  .catch(function (err) {
    // new attempt after 15s
    setTimeout(self._loop.bind(self), 15 * 1000)
    throw err
  })
}

/**
 * @param {bitcore.Transaction} tx
 * @return {Promise}
 */
PeerSync.prototype._importUnconfirmedTx = function (tx) {
  var self = this
  var stopwatch = util.stopwatch.start()
  var txid = tx.hash

  return self._storage.executeTransaction(function (client) {
    return Promise.try(function () {
      // transaction already in database?
      return client.queryAsync(SQL.select.transactions.has, ['\\x' + txid])
    })
    .then(function (result) {
      if (result.rows[0].count !== '0') {
        throw new TransactionsAlreadyExists()
      }

      // import transaction
      return client.queryAsync(SQL.insert.transactions.unconfirmed, [
        '\\x' + txid,
        '\\x' + tx.toString()
      ])
    })
    .then(function () {
      // import outputs
      return Promise.map(tx.outputs, function (output, index) {
        var addresses = self._safeGetAddresses(output, txid, index)
        if (addresses === null) {
          return
        }

        return Promise.map(addresses, function (address) {
          return client.queryAsync(SQL.insert.history.unconfirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex()
          ])
        }, {concurrency: 1})
      }, {concurrency: 1})
    })
    .then(function () {
      // import intputs
      return Promise.map(tx.inputs, function (input, index) {
        // skip coinbase
        var prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === util.ZERO_HASH) {
          return
        }

        return client.queryAsync(SQL.update.history.unconfirmedInput, [
          '\\x' + txid,
          '\\x' + prevTxId,
          input.outputIndex
        ])
      }, {concurrency: 1})
    })
    .then(function () {
      logger.verbose('Import tx %s, elapsed time: %s',
                     txid, stopwatch.formattedValue())
    })
    .catch(TransactionsAlreadyExists, function () {})
  })
}

/**
 */
PeerSync.prototype.run = function () {
  var self = this

  return self._getMyLatest()
    .then(function (latest) {
      self._latest = latest

      // only one import process at one moment
      //  @todo make parallel tx import ?
      var executor = util.makeConcurrent(function (fn) {
        return fn()
      }, {concurrency: 1})

      // block handler
      var onBlock = util.makeConcurrent(function () {
        return self._network.getLatest()
          .then(function (newBlockchainLatest) {
            self._blockchainLatest = newBlockchainLatest
            return executor(function () {
              return self._updateChain()
            })
          })
      }, {concurrency: 1})

      self._network.on('block', onBlock)
      onBlock()

      // tx handler
      var onTx = function (tx) {
        return executor(function () {
          return self._importUnconfirmedTx(tx)
        })
      }
      self._network.on('tx', onTx)
    })
}

module.exports = PeerSync
