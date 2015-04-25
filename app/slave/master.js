/* globals Promise:true */

var bitcore = require('bitcore')
var Promise = require('bluebird')

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

var errors = require('../../lib/errors')

/**
 * @event Master#block
 * @param {string} hash
 * @param {number} height
 */

/**
 * @event Master#tx
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?string} blockHeight
 */

/**
 * @event Master#address
 * @param {string} address
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?string} blockHeight
 */

/**
 * @event Master#status
 * @param {Object} status
 */

/**
 * @class Master
 * @param {Storage} storage
 */
function Master (storage) {
  EventEmitter.call(this)
  this._storage = storage
  this._sendTxDeferreds = {}
}

inherits(Master, EventEmitter)

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  /**
   * @param {string} channel
   * @param {string} handler
   * @return {Promise}
   */
  function listen (channel, handler) {
    handler = self[handler].bind(self)
    return this._storage.listen(channel, function (payload) {
      handler(JSON.parse(payload))
    })
  }

  return Promise.all([
    listen('broadcastblock', '_onBroadcastBlock'),
    listen('broadcasttx', '_onBroadcastTx'),
    listen('broadcastaddress', '_onBroadcastAddress'),
    listen('broadcaststatus', '_onBroadcastStatus'),
    listen('sendtxresponse', '_onSendTxResponse')
  ])
}

/**
 * @param {Object} payload
 */
Master.prototype._onBroadcastBlock = function (payload) {
  this.emit('block', payload.hash, payload.height)
}

/**
 * @param {Object} payload
 */
Master.prototype._onBroadcastTx = function (payload) {
  this.emit('tx', payload.txid, payload.blockHash, payload.blockHeight)
}

/**
 * @param {Object} payload
 */
Master.prototype._onBroadcastAddress = function (payload) {
  this.emit('address',
    payload.address, payload.txid, payload.blockHash, payload.blockHeight)
}

/**
 * @param {Object} payload
 */
Master.prototype._onBroadcastStatus = function (payload) {
  this.emit('status', payload)
}

/**
 * @param {Object} payload
 */
Master.prototype._onSendTxResponse = function (payload) {
  var defer = this._sendTxDeferreds[payload.id]
  if (defer === undefined) {
    return
  }

  delete this._sendTxDeferreds[payload.id]
  if (payload.status === 'success') {
    return defer.resolve()
  }

  var err = new errors.Slave.SendTxError()
  err.data = {code: payload.code, message: unescape(payload.message)}
  return defer.reject(err)
}

/**
 * @param {string} rawtx
 * @return {Promise}
 */
Master.prototype.sendTx = function (rawtx) {
  var self = this
  return new Promise(function (resolve, reject) {
    var id = bitcore.crypto.Random.getRandomBuffer(10).toString('hex')
    var payload = JSON.stringify({id: id, rawtx: rawtx})
    self._storage.notify('sendtx', payload)
      .then(function () {
        self._sendTxDeferreds[id] = {resolve: resolve, reject: reject}
      })
      .catch(reject)
  })
}

module.exports = Master
