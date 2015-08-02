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
  this._storage = storage
}

inherits(Slaves, EventEmitter)

/**
 * @return {Promise}
 */
Slaves.prototype.init = function () {
  var self = this
  return self._storage.listen('sendtx', function (payload) {
    payload = JSON.parse(payload)
    self.emit('sendTx', payload.id)
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
  return this._storage.notify('sendtxresponse', payload, opts)
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
  return this._storage.notify('broadcastblock', payload, opts)
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
  return this._storage.notify('broadcasttx', payload, opts)
}

/**
 * @param {string} address
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?string} blockHeight
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastAddress = function (address, txid, blockHash, blockHeight, opts) {
  var payload = JSON.stringify({
    address: address,
    txid: txid,
    blockHash: blockHash,
    blockHeight: blockHeight
  })
  return this._storage.notify('broadcastaddress', payload, opts)
}

/**
 * @param {Object} status
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Slaves.prototype.broadcastStatus = function (status, opts) {
  var payload = JSON.stringify(status)
  return this._storage.notify('broadcaststatus', payload, opts)
}

module.exports = Slaves
