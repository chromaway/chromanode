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
  Sync.apply(this, arguments)

  this._maxBlockDataCache = Math.max(
    config.get('chromanode.sync.maxBlockDataCache') || 0, 0)

  this._blockDataCache = LRU({
    max: this._maxBlockDataCache
  })

  this._progress = {
    value: null,
    step: null,
    latest: null
  }
  this._latest = null
  this._blockchainLatest = null
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
    [SQL.update.history.deleteUnconfirmedInputs],
    [SQL.update.history.deleteUnconfirmedOutputs]
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
 * @return {Promise<{block: bitcore.block, queries: Array.<>}>}
 */
HistorySync.prototype._getBlockData = function (height) {
  var self = this
  var promise = self._blockDataCache.get(height)

  if (promise === undefined || promise.isRejected()) {
    // download block and create queries
    var stopwatch = util.stopwatch.start()
    promise = self._network.getBlock(height)
      .then(function (block) {
        logger.verbose('Downloading block %d, elapsed time: %s',
                       height, stopwatch.format(stopwatch.value()))
        return {
          block: block,
          queries: self._getImportBlockQueries(height, block)
        }
      })

    self._blockDataCache.set(height, promise)
  }

  return promise
}

/**
 */
HistorySync.prototype._loop = function () {
  var self = this
  if (self._latest.hash === self._blockchainLatest.hash) {
    return
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
        })
    })
    .then(function () {
      return self._getBlockData(latest.height + 1)
    })
    .then(function (data) {
      // check hashPrevBlock
      if (latest.hash !== util.encode(data.block.header.prevHash)) {
        throw new errors.Master.InvalidHashPrevBlock(
          latest.hash, data.block.hash)
      }

      stopwatch = util.stopwatch.start()
      return self._storage.executeQueries(data.queries, {client: client})
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
      var stop = self._latest.height + 1 + self._maxBlockDataCache
      _.range(start, stop).forEach(function (height, index) {
        setTimeout(function () { self._getBlockData(height) }, index * 50)
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
