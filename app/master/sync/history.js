/* globals Promise:true */

var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var Promise = require('bluebird')

var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
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
 * @param {Storage} storage
 * @param {Network} network
 */
function HistorySync (storage, network) {
  EventEmitter.call(this)

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

inherits(HistorySync, EventEmitter)

/**
 * @return {Promise}
 */
HistorySync.prototype.init = function () {
  var self = this
  return self.storage.executeTransaction(function (client) {
    // remove unconfirmed data
    return Promise.all([
      client.queryAsync(SQL.delete.transactions.unconfirmed),
      client.queryAsync(SQL.update.history.deleteUnconfirmedInputs),
      client.queryAsync(SQL.update.history.deleteUnconfirmedOutputs),
      client.queryAsync(SQL.delete.history.unconfirmed)
    ])
  })
  .then(function () {
    // extract latest from network and from database
    return Promise.all([
      self.network.getLatest(),
      self.storage.executeQuery(SQL.select.blocks.latest)
    ])
  })
  .spread(function (blockchainLatest, latest) {
    // process latest to {hash: string, height: number}
    latest = latest.rowCount === 1
               ? {hash: latest.rows[0].hash, height: latest.rows[0].height}
               : {hash: util.zfill('', 64), height: -1}

    // update self.blockchainLatest on new blocks before sync finished
    function onNewBlock () {
      self.network.getLatest()
        .then(function (latest) {
          self.blockchainLatest = latest
          self._updatePercentage()
        })
    }

    self.network.on('block', onNewBlock)
    self.on('finish', function () {
      self.network.removeListener('block', onNewBlock)
    })

    // calculate progress.step
    var step = parseInt((blockchainLatest.height - latest.height) / 1000, 10)
    self.progress.step = Math.max(step, 10)

    // set progress.latest, network and database latest block
    self.progress.latest = latest.height
    self.blockchainLatest = blockchainLatest
    self.latest = latest

    // update self.progress.value
    self._updatePercentage()

    // show info message
    logger.info('Got %d blocks in current db, out of %d block at bitcoind',
                self.latest.height, self.blockchainLatest.height)
  })
}

/**
 */
HistorySync.prototype._updatePercentage = function () {
  var value = this.latest.height / this.blockchainLatest.height
  this.progress.value = value.toFixed(6)

  if (this.progress.latest + this.progress.step <= this.latest.height) {
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
HistorySync.prototype.run = function () {
  var self = this
  self.emit('start')
  // @todo
}

module.exports = HistorySync
