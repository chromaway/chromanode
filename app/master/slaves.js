/* globals Promise:true */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var Promise = require('bluebird')

var messages = require('../../lib/messages').default()

/**
 * @event Slaves#sendTx
 * @param {string} rawTx
 */

/**
 * @class Slaves
 */
function Slaves () {
  EventEmitter.call(this)
}

inherits(Slaves, EventEmitter)

/**
 * @return {Promise}
 */
Slaves.prototype.init = function () {
  var self = this

  function onSendTx (payload) {
    payload = JSON.parse(payload)
    self.emit('sendTx', payload.id, payload.rawtx)
  }

  return Promise.all([
    messages.listen('sendtx', onSendTx)
  ])
}

/**
 * @param {pg.Client} client
 * @param {string} id
 * @param {(Object|undefined)} err
 * @return {Promise}
 */
Slaves.prototype.sendTxResponse = function (client, id, err) {
  var payload = JSON.stringify({
    status: err === undefined ? 'success' : 'fail',
    id: id,
    code: (err || {}).code,
    message: escape((err || {}).message)
  })
  return messages.notify(client, 'sendtxresponse', payload)
}

/**
 * @param {pg.Client} client
 * @param {string} blockid
 * @param {number} height
 * @return {Promise}
 */
Slaves.prototype.newBlock = function (client, blockid, height) {
  var payload = JSON.stringify({blockid: blockid, height: height})
  return messages.notify(client, 'newblock', payload)
}

/**
 * @param {pg.Client} client
 * @param {string} address
 * @param {string} txid
 * @return {Promise}
 */
Slaves.prototype.addressTouched = function (client, address, txid) {
  var payload = JSON.stringify({address: address, txid: txid})
  return messages.notify(client, 'addresstouched', payload)
}

module.exports = require('soop')(Slaves)
