/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var Promise = require('bluebird')
var RpcClient = require('bitcoind-rpc')

var config = require('../../lib/config')
var errors = require('../../lib/errors')
var logger = require('../../lib/logger').logger

/**
 * @class Bitcoind
 */
function Bitcoind () {}

/**
 * @return {Promise}
 */
Bitcoind.prototype.init = function () {
  var self = this
  return Promise.try(function () {
    // request info
    self.bitcoind = Promise.promisifyAll(new RpcClient(config.get('bitcoind')))
    return self.bitcoind.getInfoAsync()
  })
  .then(function (ret) {
    var bitcoindNetwork = ret.result.testnet ? 'testnet' : 'livenet'
    if (bitcoindNetwork !== config.get('chromanode.network')) {
      throw new errors.InvalidBitcoindNetwork()
    }

    logger.info('Connected to bitcoind! (ver. %d)', ret.result.version)
  })
}

/**
 * @return {Promise<{height: number, blockid: string}>}
 */
Bitcoind.prototype.getLatest = function () {
  var latest = {}
  var bitcoind = this.bitcoind
  return bitcoind.getBlockCountAsync()
    .then(function (ret) {
      latest.height = ret.result
      return bitcoind.getBlockHashAsync(latest.height)
    })
    .then(function (ret) {
      latest.blockid = ret.result
      return latest
    })
}

/**
 * @param {number} height
 * @return {Promise<bitcore.Block>}
 */
Bitcoind.prototype.getBlock = function (height) {
  var bitcoind = this.bitcoind
  return bitcoind.getBlockHashAsync(height)
    .then(function (ret) {
      return bitcoind.getBlockAsync(ret.result, false)
    })
    .then(function (ret) {
      var rawBlock = new Buffer(ret.result, 'hex')
      return new bitcore.Block(rawBlock)
    })
}

/**
 * @return {Promise<string[]>}
 */
Bitcoind.prototype.getRawMemPool = function () {
  return this.bitcoind.getRawMemPoolAsync()
    .then(function (ret) { return ret.result })
}

/**
 * @param {string[]}
 * @return {Promise<Transaction[]>}
 */
Bitcoind.prototype.getTransactions = function (txids) {
  var bitcoind = this.bitcoind

  function batchCall () {
    txids.forEach(function (txid) {
      bitcoind.getRawTransaction(txid)
    })
  }

  return bitcoind.batchAsync(batchCall)
    .then(function (ret) {
      return _.pluck(ret, 'result').map(bitcore.Transaction)
    })
}

module.exports = require('soop')(Bitcoind)
