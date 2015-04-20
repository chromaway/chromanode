var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var bitcore = require('bitcore')

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
 */
function Sync () {
  EventEmitter.call(this)

  var networkName = config.get('chromanode.network')
  this.bitcoinNetwork = bitcore.Networks.get(networkName)
}

inherits(Sync, EventEmitter)

/**
 * @param {Buffer} buf
 * @param {string} type
 * @return {string}
 */
Sync.prototype._createAddress = function (buf, type) {
  var address = new Address(buf, this.bitcoinNetwork, type)
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
 */
Sync.prototype._getImportBlockQueries = function (height, block) {
  var self = this
  var queries = []

  // import header
  queries.push([SQL.insert.blocks.row, [
    height,
    '\\x' + block.hash,
    '\\x' + block.header.toString(),
    '\\x' + _.pluck(block.transactions, 'hash').join('')
  ]])

  // import transactions
  block.transactions.forEach(function (tx) {
    queries.push([SQL.insert.transactions.confirmed, [
      '\\x' + tx.hash,
      height,
      '\\x' + tx.toString()
    ]])
  })

  // import outputs
  block.transactions.forEach(function (tx) {
    tx.outputs.forEach(function (output, index) {
      self._getAddresses(output.script).forEach(function (address) {
        queries.push([SQL.insert.history.confirmedOutput, [
          address,
          '\\x' + tx.hash,
          index,
          output.satoshis,
          '\\x' + output.script.toHex(),
          height
        ]])
      })
    })
  })

  // import inputs
  block.transactions.forEach(function (tx) {
    tx.inputs.forEach(function (input, index) {
      // skip coinbase
      var prevTxId = input.prevTxId.toString('hex')
      if (index === 0 &&
          input.outputIndex === 0xffffffff &&
          prevTxId === ZERO_HASH) {
        return
      }

      queries.push([SQL.update.history.confirmedInput, [
        '\\x' + tx.hash,
        index,
        height,
        '\\x' + prevTxId,
        input.outputIndex
      ]])
    })
  })

  return queries
}

/**
 * @param {number} to
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Sync.prototype._reorgTo = function (to, opts) {
  logger.warning('Reorg found: from %d to %d', this.latest.height, to)
  return this.storage.executeQueries([
    [SQL.delete.blocks.fromHeight, [to]],
    [SQL.delete.transactions.fromHeight, [to]],
    [SQL.delete.history.fromHeight, [to]],
    [SQL.update.history.deleteInputsFromHeight, [to]],
    [SQL.update.history.deleteOutputsFromHeight, [to]]
  ], _.defaults({concurrency: 1}, opts))
}

/**
 * @param {Objects} [opts]
 * @param {pg.Client} [opts.client]
 */
Sync.prototype._getMyLatest = function (opts) {
  var self = this
  return self.storage.executeQueries([[SQL.select.blocks.latest]], opts)
    .spread(function (result) {
      if (result.rowCount === 0) {
        return {hash: util.zfill('', 64), height: -1}
      }

      var row = result.rows[0]
      return {hash: row.hash.toString('hex'), height: row.height}
    })
}

module.exports = Sync
