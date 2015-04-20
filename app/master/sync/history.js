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
 * @param {Storage} storage
 * @param {Network} network
 */
function HistorySync (storage, network) {
  Sync.call(this)

  this.storage = storage
  this.network = network

  this.progress = {
    value: null,
    step: null,
    latest: null
  }
  this.latest = null
  this.blockchainLatest = null
}

inherits(HistorySync, Sync)

/**
 * @return {Promise}
 */
HistorySync.prototype.init = function () {
  var self = this
  // remove unconfirmed data
  return self.storage.executeQueries([
    [SQL.delete.transactions.unconfirmed],
    [SQL.delete.history.unconfirmed],
    [SQL.update.history.deleteUnconfirmedInputs],
    [SQL.update.history.deleteUnconfirmedOutputs]
  ], {concurrency: 1})
  .then(function () {
    // extract latest from network and from database
    return Promise.all([
      self.network.getLatest(),
      self._getMyLatest()
    ])
  })
  .spread(function (blockchainLatest, latest) {
    // update self.blockchainLatest on new blocks before sync finished
    function onNewBlock () {
      self.network.getLatest()
        .then(function (blockchainLatest) {
          self.blockchainLatest = blockchainLatest
          self._updateProgress()
        })
    }

    self.network.on('block', onNewBlock)
    self.on('finish', function () {
      self.network.removeListener('block', onNewBlock)
    })

    // calculate progress.step
    var fstep = (blockchainLatest.height - latest.height) / 1000
    var step = parseInt(fstep, 10)
    self.progress.step = Math.max(step, 10)

    // set progress.latest, network and database latest block
    self.progress.latest = latest.height
    self.latest = latest
    self.blockchainLatest = blockchainLatest

    // update self.progress.value
    self._updateProgress()

    // show info message
    logger.info('Got %d blocks in current db, out of %d block at bitcoind',
                self.latest.height + 1, self.blockchainLatest.height)
  })
}

/**
 */
HistorySync.prototype._updateProgress = function () {
  var value = this.latest.height / this.blockchainLatest.height
  this.progress.value = value.toFixed(6)

  if (this.progress.latest + this.progress.step <= this.latest.height ||
      this.progress.value === '1.000000') {
    this.progress.latest = this.latest.height

    logger.info('HistorySync progress: %s', this.progress.value)
    this.emit('progress')
  }
}

/**
 * @return {Object}
 */
HistorySync.prototype.getInfo = function () {
  return {
    progress: this.progress.value,
    latest: _.clone(this.latest),
    blockchainLatest: _.clone(this.blockchainLatest)
  }
}

/**
 */
HistorySync.prototype._loop = function () {
  var self = this
  if (self.latest.hash === self.blockchainLatest.hash) {
    return
  }

  var latest = _.clone(self.latest)
  return self.storage.executeTransaction(function (client) {
    return Promise.try(function () {
      if (latest.height + 1 < self.blockchainLatest.height) {
        return
      }

      // reorg found
      var to = self.blockchainLatest.height - 1
      return self._reorgTo(to, {client: client})
        .then(function () {
          return self._getMyLatest({client: client})
        })
        .then(function (newLatest) {
          latest = newLatest
        })
    })
    .then(function () {
      // download block
      return self.network.getBlock(latest.height + 1)
    })
    .then(function (block) {
      // check hashPrevBlock
      if (latest.hash !== util.encode(block.header.prevHash)) {
        throw new errors.Master.InvalidHashPrevBlock(latest.hash, block.hash)
      }

      // create queries and execute
      var queries = self._getImportBlockQueries(latest.height + 1, block)
      return self.storage.executeQueries(queries, {client: client})
    })
    .then(function () {
      return self._getMyLatest({client: client})
    })
  })
  .then(function (newLatest) {
    // new latest
    self.latest = newLatest

    // verbose logging
    logger.verbose('Import block #%d - %s',
                   self.latest.height, self.latest.hash)

    // update self.progress and emit progress if need
    self._updateProgress()

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
