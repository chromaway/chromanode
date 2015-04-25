/* globals Promise:true */

var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var bitcore = require('bitcore')
var Promise = require('bluebird')

var config = require('../../../lib/config')
var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var SQL = require('./sql')

var Address = bitcore.Address
var Hash = bitcore.crypto.Hash

/**
 * @event Sync#latest
 * @param {{hash: string, height: number}} latest
 */

/**
 * @class Sync
 * @extends events.EventEmitter
 * @param {Storage} storage
 * @param {Network} network
 * @param {Slaves} slaves
 */
function Sync (storage, network, slaves) {
  EventEmitter.call(this)

  this._storage = storage
  this._network = network
  this._slaves = slaves

  var networkName = config.get('chromanode.network')
  this._bitcoinNetwork = bitcore.Networks.get(networkName)

  this._latest = null
  this._blockchainLatest = null
}

inherits(Sync, EventEmitter)

/**
 * @param {Buffer} buf
 * @param {string} type
 * @return {string}
 */
Sync.prototype._createAddress = function (buf, type) {
  var address = new Address(buf, this._bitcoinNetwork, type)
  return address.toString()
}

/**
 * @param {bitcore.Script} script
 * @return {string[]}
 */
Sync.prototype._getAddresses = function (script) {
  var self = this

  if (script.isPublicKeyHashOut()) {
    return [
      self._createAddress(script.chunks[2].buf, Address.PayToPublicKeyHash)
    ]
  }

  if (script.isScriptHashOut()) {
    return [
      self._createAddress(script.chunks[1].buf, Address.PayToScriptHash)
    ]
  }

  if (script.isMultisigOut()) {
    return script.chunks.slice(1, -2).map(function (chunk) {
      var hash = Hash.sha256ripemd160(chunk.buf)
      return self._createAddress(hash, Address.PayToPublicKeyHash)
    })
  }

  if (script.isPublicKeyOut()) {
    var hash = Hash.sha256ripemd160(script.chunks[0].buf)
    return [
      self._createAddress(hash, Address.PayToPublicKeyHash)
    ]
  }

  return []
}

/**
 * @param {bitcore.Transaction.Output} output
 * @param {string} txid
 * @param {number} index
 * @return {string[]}
 */
Sync.prototype._safeGetAddresses = function (output, txid, index) {
  try {
    return this._getAddresses(output.script)
  } catch (err) {
    logger.error('On get addresses for output %s:%s %s',
                 txid, index, err.stack)
    return []
  }
}

/**
 * @param {number} to
 * @param {pg.Client} client
 * @return {Promise}
 */
Sync.prototype._reorgTo = function (to, client) {
}

/**
 * @return {Promise<boolean>}
 */
Sync.prototype._updateChain = function () {
  var self = this
  if (self._latest.hash === self._blockchainLatest.hash) {
    return Promise.resolve(false)
  }

  var stopwatch
  var latest = _.clone(self._latest)
  return self._storage.executeTransaction(function (client) {
    return new Promise(function (resolve, reject) {
      function tryGetBlock () {
        return self._getBlock(latest.height + 1)
          .then(function (block) {
            if (latest.height < self._blockchainLatest.height &&
                latest.hash === util.encode(block.header.prevHash)) {
              return resolve(block)
            }

            // reorg found
            if (self._blockCache !== undefined) {
              self._blockCache.reset()
            }

            var to = Math.min(latest.height - 1,
                              self._blockchainLatest.height - 1)
            var opts = {client: client, concurrency: 1}

            stopwatch = util.stopwatch.start()
            return self._storage.executeQueries([
              [SQL.delete.blocks.fromHeight, [to]],
              [SQL.delete.transactions.fromHeight, [to]],
              [SQL.delete.history.fromHeight, [to]],
              [SQL.update.history.deleteInputsFromHeight, [to]]
            ], opts)
            .then(function () {
              logger.warn('Reorg finished (back to %d), elapsed time: %s',
                             to, stopwatch.formattedValue())
              return self._getMyLatest({client: client})
            })
            .then(function (newLatest) {
              latest = newLatest
            })
            .then(tryGetBlock, reject)
          })
      }

      tryGetBlock()
    })
    .then(function (block) {
      stopwatch = util.stopwatch.start()
      return self._importBlock(block, latest.height + 1, client)
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

    return true
  })
}

/**
 * @param {Objects} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise<{hash: string, height: number}>}
 */
Sync.prototype._getMyLatest = function (opts) {
  var self = this
  return self._storage.executeQueries([[SQL.select.blocks.latest]], opts)
    .spread(function (result) {
      if (result.rowCount === 0) {
        return {hash: util.ZERO_HASH, height: -1}
      }

      var row = result.rows[0]
      return {hash: row.hash.toString('hex'), height: row.height}
    })
}

module.exports = Sync
