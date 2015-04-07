/* globals Promise:true */

var bitcore = require('bitcore')
var Promise = require('bluebird')

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

var errors = require('../../lib/errors')
var messages = require('../../lib/messages').default()
var storage = require('../../lib/storage').default()

/**
 * @event Master#newBlock
 * @param {string} blockid
 * @param {number} height
 */

/**
 * @event Master#addressTouched
 * @param {string} address
 * @param {string} txid
 */

/**
 * @class Master
 */
function Master () {
  EventEmitter.call(this)
  this._sendTxDeferreds = {}
}

inherits(Master, EventEmitter)

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  function onNewBlock (payload) {
    payload = JSON.parse(payload)
    self.emit('newBlock', payload.blockid, payload.height)
  }

  function onAddressTouched (payload) {
    payload = JSON.parse(payload)
    self.emit('addressTouched', payload.address, payload.txid)
  }

  function onSendTxResponse (payload) {
    payload = JSON.parse(payload)
    var defer = self._sendTxDeferreds[payload.id]
    if (defer === undefined) {
      return
    }

    delete self._sendTxDeferreds[payload.id]
    if (payload.status === 'success') {
      return defer.resolve()
    }

    var err = new errors.Slave.SendTxError()
    err.data = {code: payload.code, message: unescape(payload.message)}
    return defer.reject(err)
  }

  return Promise.all([
    messages.listen('newblock', onNewBlock),
    messages.listen('addresstouched', onAddressTouched),
    messages.listen('sendtxresponse', onSendTxResponse)
  ])
}

/**
 * @param {string} rawtx
 * @return {Promise}
 */
Master.prototype.sendTx = function (rawtx) {
  var deferred = Promise.defer()
  var id = bitcore.crypto.Random.getRandomBuffer(10).toString('hex')

  this._sendTxDeferreds[id] = deferred

  return storage.execute(function (client) {
    var payload = JSON.stringify({id: id, rawtx: rawtx})
    return messages.notify(client, 'sendtx', payload)
  })
  .then(function () {
    return deferred.promise
  })
}

module.exports = require('soop')(Master)
