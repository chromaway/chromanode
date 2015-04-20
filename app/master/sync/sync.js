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

var ZERO_HASH = util.zfill('', 64)

/**
 * @class Sync
 * @extends events.EventEmitter
 * @param {Storage} storage
 * @param {Network} network
 */
function Sync (storage, network) {
  EventEmitter.call(this)

  this._storage = storage
  this._network = network

  var networkName = config.get('chromanode.network')
  this._bitcoinNetwork = bitcore.Networks.get(networkName)
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
 * @param {number} height
 * @param {bitcore.Block} block
 * @param {pg.Client} client
 * @return {Promise}
 */
Sync.prototype._importBlock = function (height, block, client) {
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
 * @param {number} to
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Sync.prototype._reorgTo = function (to, opts) {
  logger.warning('Reorg found: from %d to %d', this.latest.height, to)
  var stopwatch = util.stopwatch.start()
  return this._storage.executeQueries([
    [SQL.delete.blocks.fromHeight, [to]],
    [SQL.delete.transactions.fromHeight, [to]],
    [SQL.delete.history.fromHeight, [to]],
    [SQL.update.history.deleteInputsFromHeight, [to]],
    [SQL.update.history.deleteOutputsFromHeight, [to]]
  ], _.defaults({concurrency: 1}, opts))
  .then(function (result) {
    logger.verbose('Reorg execution, elapsed time: %s',
                    stopwatch.format(stopwatch.value()))
    return result
  })
}

/**
 * @param {Objects} [opts]
 * @param {pg.Client} [opts.client]
 */
Sync.prototype._getMyLatest = function (opts) {
  var self = this
  return self._storage.executeQueries([[SQL.select.blocks.latest]], opts)
    .spread(function (result) {
      if (result.rowCount === 0) {
        return {hash: util.zfill('', 64), height: -1}
      }

      var row = result.rows[0]
      return {hash: row.hash.toString('hex'), height: row.height}
    })
}

module.exports = Sync
