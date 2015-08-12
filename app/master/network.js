'use strict'

var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')
var bitcore = require('bitcore')
var p2p = require('bitcore-p2p')
var RpcClient = require('bitcoind-rpc')

var config = require('../../lib/config')
var errors = require('../../lib/errors')
var logger = require('../../lib/logger').logger
var util = require('../../lib/util')

/**
 * @event Network#block
 * @param {string} hash
 */

/**
 * @event Network#tx
 * @param {string} txid
 */

/**
 * @class Network
 */
function Network () {
  EventEmitter.call(this)
}

inherits(Network, EventEmitter)

/**
 * @return {Promise}
 */
Network.prototype.init = function () {
  return Promise.all([this._initBitcoind(), this._initTrustedPeer()])
}

/**
 * @return {Promise}
 */
Network.prototype._initBitcoind = function () {
  var self = this

  // create rpc client
  self.bitcoind = Promise.promisifyAll(new RpcClient({
    host: config.get('bitcoind.rpc.host'),
    port: config.get('bitcoind.rpc.port'),
    user: config.get('bitcoind.rpc.user'),
    pass: config.get('bitcoind.rpc.pass'),
    protocol: config.get('bitcoind.rpc.protocol')
  }))

  // request info
  return self.bitcoind.getInfoAsync()
    .then(function (ret) {
      // check network
      var bitcoindNetwork = ret.result.testnet ? 'testnet' : 'livenet'
      var chromanodeNetwork = config.get('chromanode.network')
      if (bitcoindNetwork !== chromanodeNetwork &&
          !(bitcoindNetwork === 'livenet' && chromanodeNetwork === 'regtest')) {
        throw new errors.InvalidBitcoindNetwork(bitcoindNetwork, chromanodeNetwork)
      }

      // show info
      logger.info(
        'Bitcoind checked. (version %d, bestHeight: %s, connections: %s)',
        ret.result.version, ret.result.blocks, ret.result.connections)
    })
}

/**
 * @return {Promise}
 */
Network.prototype._initTrustedPeer = function () {
  var self = this

  // create trusted peer
  self.peer = new p2p.Peer({
    host: config.get('bitcoind.peer.host'),
    port: config.get('bitcoind.peer.port'),
    network: config.get('chromanode.network')
  })
  timers.setImmediate(function () { self.peer.connect() })

  // inv event
  self.peer.on('inv', function (message) {
    var names = []

    message.inventory.forEach(function (inv) {
      // store inv type name
      names.push(p2p.Inventory.TYPE_NAME[inv.type])

      // store inv if tx type
      if (inv.type === p2p.Inventory.TYPE.TX) {
        self.emit('tx', util.encode(inv.hash))
      }

      // emit block if block type
      if (inv.type === p2p.Inventory.TYPE.BLOCK) {
        self.emit('block', util.encode(inv.hash))
      }
    })

    logger.verbose('Receive inv (%s) message from peer %s:%s',
                   names.join(', '), self.peer.host, self.peer.port)
  })

  // connect event
  self.peer.on('connect', function () {
    logger.info('Connected to network peer %s:%s',
                self.peer.host, self.peer.port)
  })

  // disconnect event
  self.peer.on('disconnect', function () {
    logger.info('Disconnected from network peer %s:%s',
                self.peer.host, self.peer.port)
  })

  // ready event
  self.peer.on('ready', function () {
    logger.info(
      'Peer %s:%s is ready (version: %s, subversion: %s, bestHeight: %s)',
      self.peer.host, self.peer.port,
      self.peer.version, self.peer.subversion, self.peer.bestHeight)
  })

  // waiting peer ready
  return new Promise(function (resolve) {
    self.peer.on('ready', resolve)
  })
}

/**
 * @return {Promise<Object>}
 */
Network.prototype.getBitcoindInfo = function () {
  return this.bitcoind.getInfoAsync()
    .then(function (ret) { return ret.result })
}

/**
 * @return {Promise<number>}
 */
Network.prototype.getBlockCount = function () {
  return this.bitcoind.getBlockCountAsync()
    .then(function (ret) { return ret.result })
}

/**
 * @param {number} height
 * @return {Promise<string>}
 */
Network.prototype.getBlockHash = function (height) {
  return this.bitcoind.getBlockHashAsync(height)
    .then(function (ret) { return ret.result })
}

/**
 * @param {(number|string)} id
 * @return {Promise<bitcore.Block>}
 */
Network.prototype.getBlock = function (id) {
  var self = this
  return Promise.try(function () {
    if (_.isNumber(id)) {
      return self.getBlockHash(id)
    }

    return id
  })
  .then(function (hash) {
    return self.bitcoind.getBlockAsync(hash, false)
  })
  .then(function (ret) {
    var rawBlock = new Buffer(ret.result, 'hex')
    return new bitcore.Block(rawBlock)
  })
}

/**
 * @return {Promise<{hash: string, height: number}>}
 */
Network.prototype.getLatest = function () {
  var self = this
  return self.getBlockCount()
    .then(function (height) {
      return Promise.all([height, self.getBlockHash(height)])
    })
    .spread(function (height, hash) {
      return {hash: hash, height: height}
    })
}

/**
 * @todo Add concurrency
 * @param {string} txid
 * @return {Promise<bitcore.Transaction>}
 */
Network.prototype.getTx = function (txid) {
  return this.bitcoind.getRawTransactionAsync(txid)
    .then(function (ret) {
      var rawtx = new Buffer(ret.result, 'hex')
      return new bitcore.Transaction(rawtx)
    })
}

/**
 * @param {string} rawtx
 * @return {Promise}
 */
Network.prototype.sendTx = function (rawtx) {
  return this.bitcoind.sendRawTransactionAsync(rawtx)
}

/**
 * @return {Promise<string[]>}
 */
Network.prototype.getMempoolTxs = function () {
  return this.bitcoind.getRawMemPoolAsync()
    .then(function (ret) { return ret.result })
}

module.exports = Network
