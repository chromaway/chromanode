/* globals Promise:true */

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')

var errors = require('../../../lib/errors')
var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')

/**
 * @event PeerSync#newBlock
 * @param {string} hash
 * @param {number} height
 */

/**
 * @event PeerSync#newTx
 * @param {string} txid
 */

/**
 * @event PeerSync#address
 * @param {string} address
 * @param {string} txid
 */

/**
 * @class PeerSync
 * @extends Sync
 */
function PeerSync () {
  Sync.apply(this, arguments)

  this._latest = null
  this._blockchainLatest = null
}

inherits(PeerSync, Sync)

/**
 * @return {Promise}
 */
PeerSync.prototype.init = function () {
  return Promise.resolve()
}

/**
 * @param {function} fn
 * @return {Promise}
 */
PeerSync.prototype._executeTransaction = util.makeCuncurrent(function (fn) {
  return this._storage._executeTransaction(fn)
}, {concurrency: 1})

/**
 * @return {Promise}
 */
PeerSync.prototype._updateChain = util.makeCuncurrent(function () {
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
  return self._executeTransaction(function (client) {
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
}, {concurrency: 1})

/**
 * @param {bitcore.Transaction} tx
 * @return {Promise}
 */
PeerSync.prototype._importUnconfirmedTx = util.makeCuncurrent(function (tx) {
})

/**
 */
PeerSync.prototype.run = function () {
  var self = this

  self._getMyLatest(function (latest) {
    self._latest = latest

    var onNewBlock = util.makeCuncurrent(function () {
      return self._network.getLatest()
        .then(function (blockchainLatest) {
          self._blockchainLatest = blockchainLatest
          return self._updateChain()
        })
    }, {concurrency: 1})

    self._network.on('block', onNewBlock)
    onNewBlock()

    // var onNewTx
  })
}

module.exports = PeerSync
