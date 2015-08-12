'use strict'

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')
var LRU = require('lru-cache')

var config = require('../../../lib/config')
var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('../sql')

/**
 * @class HistorySync
 * @extends Sync
 */
function HistorySync () {
  var self = this
  Sync.apply(self, arguments)

  self._maxCachedBlocks = Math.max(
    config.get('chromanode.sync.maxCachedBlocks') || 0, 0)

  self._blockCache = LRU({
    max: self._maxCachedBlocks
  })

  self._progress = null
}

inherits(HistorySync, Sync)

/**
 * @param {number} height
 * @return {Promise<bitcore.block>}
 */
HistorySync.prototype._getBlock = function (height) {
  var self = this
  var block = self._blockCache.get(height)

  if (block === undefined || block.isRejected()) {
    // download block and create queries
    var stopwatch = util.stopwatch.start()
    block = self._network.getBlock(height)
      .then(function (block) {
        logger.verbose('Downloading block %d, elapsed time: %s',
                       height, stopwatch.formattedValue())
        return block
      })

    self._blockCache.set(height, block)
  }

  return block
}

/**
 * @param {bitcore.Block} block
 * @param {number} height
 * @param {pg.Client} client
 * @return {Promise}
 */
HistorySync.prototype._importBlock = function (block, height, client) {
  var self = this

  var txids = _.pluck(block.transactions, 'hash')

  return Promise.try(function () {
    // import header
    return client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ])
  })
  .then(function () {
    // import transactions
    return Promise.map(block.transactions, function (tx, txIndex) {
      return client.queryAsync(SQL.insert.transactions.confirmed, [
        '\\x' + txids[txIndex],
        height,
        '\\x' + tx.toString()
      ])
    }, {concurrency: 1})
  })
  .then(function () {
    // import outputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      return Promise.map(tx.outputs, function (output, index) {
        var addresses = self._safeGetAddresses(output, txids[txIndex], index)
        return Promise.map(addresses, function (address) {
          return client.queryAsync(SQL.insert.history.confirmedOutput, [
            address,
            '\\x' + txids[txIndex],
            index,
            output.satoshis,
            '\\x' + output.script.toHex(),
            height
          ])
        }, {concurrency: 1})
      }, {concurrency: 1})
    }, {concurrency: 1})
  })
  .then(function () {
    // import inputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      return Promise.map(tx.inputs, function (input, index) {
        // skip coinbase
        var prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === util.ZERO_HASH) {
          return
        }

        return client.queryAsync(SQL.update.history.addConfirmedInput, [
          '\\x' + txids[txIndex],
          height,
          '\\x' + prevTxId,
          input.outputIndex
        ])
      }, {concurrency: 1})
    }, {concurrency: 1})
  })
}

/**
 */
HistorySync.prototype.run = function () {
  var self = this

  var onBlockchainNewBlock = util.makeConcurrent(function () {
    return self._network.getLatest()
      .then(function (newBlockchainLatest) {
        self._blockchainLatest = newBlockchainLatest
      })
  }, {concurrency: 1})

  // remove unconfirmed data
  var stopwatch = util.stopwatch.start()
  return self._storage.executeQueries([
    [SQL.delete.transactions.unconfirmed],
    [SQL.delete.history.unconfirmed],
    [SQL.update.history.deleteUnconfirmedInputs]
  ], {concurrency: 1})
  .then(function () {
    logger.info('Delete unconfirmed data, elapsed time: %s',
                stopwatch.formattedValue())

    self._network.on('block', onBlockchainNewBlock)

    // extract from db and network
    return Promise.all([
      self._getMyLatest().then(function (latest) { self._latest = latest }),
      onBlockchainNewBlock()
    ])
  })
  .then(function () {
    // show info message
    logger.info('Got %d blocks in current db, out of %d block at bitcoind',
                self._latest.height + 1, self._blockchainLatest.height + 1)
  })
  .then(function () {
    return new Promise(function (resolve) {
      function loop () {
        self._updateChain()
          .then(function (updated) {
            // emit latest
            self.emit('latest', self._latest)

            // fill block cache
            if (self._latest.height + 500 < self._blockchainLatest.height) {
              var start = self._latest.height + 1
              var stop = self._latest.height + self._maxCachedBlocks + 1
              _.range(start, stop).forEach(function (height, index) {
                setTimeout(function () { self._getBlock(height) }, index)
              })
            }

            // updated is false mean that latest.hash === blockchainLatest.hash
            if (updated === false) {
              return resolve()
            }

            // run loop again...
            timers.setImmediate(loop)
          })
          .catch(function (err) {
            // new attempt after 15s
            setTimeout(loop, 15 * 1000)
            throw err
          })
      }

      loop()
    })
  })
  .finally(function () {
    self._network.removeListener('block', onBlockchainNewBlock)
    self._blockCache.reset()
  })
}

module.exports = HistorySync
