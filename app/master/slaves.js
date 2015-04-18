var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

/**
 * @event Slaves#sendTx
 * @param {string} id
 * @param {string} rawtx
 */

/**
 * @class Slaves
 * @param {Storage} storage
 */
function Slaves (storage) {
  EventEmitter.call(this)
  this.storage = storage
}

inherits(Slaves, EventEmitter)

/**
 * @return {Promise}
 */
Slaves.prototype.init = function () {
  var self = this
  return self.storage.listen('sendTx', function (payload) {
    payload = JSON.parse(payload)
    self.emit('sendTx', payload.id, payload.rawtx)
  })
}

/**
 * @param {string} id
 * @param {?Object} err
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.sendTxResponse = function (id, err, opts) {
  var payload = JSON.stringify({
    status: err === null ? 'success' : 'fail',
    id: id,
    code: (err || {}).code,
    message: escape((err || {}).message)
  })
  return this.storage.notify('sendtxresponse', payload, opts)
}

/**
 * @param {string} hash
 * @param {number} height
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastBlock = function (hash, height, opts) {
  var payload = JSON.stringify({hash: hash, height: height})
  return this.storage.notify('broadcastblock', payload, opts)
}

/**
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?number} blockHeight
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastTx = function (txid, blockHash, blockHeight, opts) {
  var payload = JSON.stringify({
    txid: txid,
    blockHash: blockHash,
    blockHeight: blockHeight
  })
  return this.storage.notify('broadcasttx', payload, opts)
}

/**
 * @param {string} address
 * @param {string} txid
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastAddressTx = function (address, txid, opts) {
  var payload = JSON.stringify({address: address, txid: txid})
  return this.storage.notify('broadcastaddresstx', payload, opts)
}

/**
 * @param {Object} status
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastStatus = function (status, opts) {
  var payload = JSON.stringify(status)
  return this.storage.notify('broadcaststatus', payload, opts)
}

module.exports = Slaves
