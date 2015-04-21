/* globals Promise:true */

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')
var LRU = require('lru-cache')

var config = require('../../../lib/config')
var errors = require('../../../lib/errors')
var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('./sql')

var ZERO_HASH = util.zfill('', 64)

/**
 * @event HistorySync#start
 */

/**
 * @event HistorySync#progress
 */

/**
 * @event HistorySync#finish
 */

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
  self.on('finish', function () { self._blockCache.reset() })

  self._progress = {
    value: null,
    step: null,
    latest: null
  }
  self._latest = null
  self._blockchainLatest = null
}

inherits(HistorySync, Sync)

/**
 * @return {Promise}
 */
HistorySync.prototype.init = function () {
  var self = this
  // remove unconfirmed data
  var stopwatch = util.stopwatch.start()
  return self._storage.executeQueries([
    [SQL.delete.transactions.unconfirmed],
    [SQL.delete.history.unconfirmed],
    [SQL.update.history.deleteUnconfirmedInputs]
  ], {concurrency: 1})
  .then(function () {
    logger.verbose('Delete unconfirmed data, elapsed time: %s',
                   stopwatch.format(stopwatch.value()))

    // extract latest from network and from database
    return Promise.all([
      self._network.getLatest(),
      self._getMyLatest()
    ])
  })
  .spread(function (blockchainLatest, latest) {
    // update self._blockchainLatest on new blocks before sync finished
    function onNewBlock () {
      self._network.getLatest()
        .then(function (blockchainLatest) {
          self._blockchainLatest = blockchainLatest
          self._updateProgress()
        })
    }

    self._network.on('block', onNewBlock)
    self.on('finish', function () {
      self._network.removeListener('block', onNewBlock)
    })

    // calculate progress.step
    var fstep = (blockchainLatest.height - latest.height) / 1000
    var step = parseInt(fstep, 10)
    self._progress.step = Math.max(step, 10)

    // set self.progress.latest, network and database latest block
    self._progress.latest = latest.height
    self._latest = latest
    self._blockchainLatest = blockchainLatest

    // update self._progress.value
    self._updateProgress()

    // show info message
    logger.info('Got %d blocks in current db, out of %d block at bitcoind',
                self._latest.height + 1, self._blockchainLatest.height)
  })
}

/**
 */
HistorySync.prototype._updateProgress = function () {
  var value = this._latest.height / this._blockchainLatest.height
  this._progress.value = value.toFixed(6)

  if (this._progress.latest + this._progress.step <= this._latest.height ||
      this._progress.value === '1.000000') {
    this._progress.latest = this._latest.height

    logger.info('HistorySync progress: %s', this._progress.value)
    this.emit('progress')
  }
}

/**
 * @return {Object}
 */
HistorySync.prototype.getInfo = function () {
  return {
    progress: this._progress.value,
    latest: _.clone(this._latest),
    blockchainLatest: _.clone(this._blockchainLatest)
  }
}

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
                       height, stopwatch.format(stopwatch.value()))
        return block
      })

    self._blockCache.set(height, block)
  }

  return block
}

/**
 * @param {number} height
 * @param {bitcore.Block} block
 * @param {pg.Client} client
 * @return {Promise}
 */
HistorySync.prototype._importBlock = function (height, block, client) {
  var self = this

  var txids = _.pluck(block.transactions, 'hash')

  return Promise.try(function () {
    // import header
    return client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + _.pluck(block.transactions, 'hash').join('')
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
        var addresses = self._getAddresses(output.script)
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
            prevTxId === ZERO_HASH) {
          return
        }

        return client.queryAsync(SQL.update.history.confirmedInput, [
          '\\x' + txids[txIndex],
          index,
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
HistorySync.prototype._loop = function () {
  var self = this
  if (self._latest.hash === self._blockchainLatest.hash) {
    return self.emit('finish')
  }

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
          // reset block cache
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
 */
HistorySync.prototype.run = function () {
  this.emit('start')
  this._loop()
}

module.exports = HistorySync
