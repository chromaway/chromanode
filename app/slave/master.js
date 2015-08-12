/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('../../lib/patchedbitcore')
var Promise = require('bluebird')

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

var errors = require('../../lib/errors')

var sql = require('./sql')

/**
 * @event Master#block
 * @param {Object} payload
 * @param {string} payload.hash
 * @param {number} payload.height
 */

/**
 * @event Master#tx
 * @param {Object} payload
 * @param {string} payload.txid
 * @param {?string} payload.blockHash
 * @param {?string} payload.blockHeight
 */

/**
 * @event Master#address
 * @param {Object} payload
 * @param {string} payload.address
 * @param {string} payload.txid
 * @param {?string} payload.blockHash
 * @param {?string} payload.blockHeight
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
  var self = this
  EventEmitter.call(self)

  self._storage = storage
  self._sendTxDeferreds = {}

  self._lastStatus = new Promise(function (resolve) {
    self.on('status', function (status) {
      if (self._lastStatus.isPending()) {
        return resolve(status)
      }

      self._lastStatus = Promise.resolve(status)
    })
  })
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
    if (_.isString(handler)) {
      var event = handler
      handler = function (payload) { self.emit(event, payload) }
    }

    return self._storage.listen(channel, function (payload) {
      handler(JSON.parse(payload))
    })
  }

  return Promise.all([
    listen('broadcastblock', 'block'),
    listen('broadcasttx', 'tx'),
    listen('broadcastaddress', 'address'),
    listen('broadcaststatus', 'status'),
    listen('sendtxresponse', self._onSendTxResponse.bind(self))
  ])
}

/**
 * @return {Promise<Object>}
 */
Master.prototype.getStatus = function () {
  return this._lastStatus
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
  return this._storage.execute(function (client) {
    return client.queryAsync(sql.insert.new_txs.row, [rawtx]).then(
      function (result) {
        var id = result.rows[0].id
        return new Promise(function (resolve, reject) {
            self._sendTxDeferreds[id] = { resolve: resolve, reject: reject }
            self._storage.notify('sendtx', JSON.stringify({id: id})).catch(reject)
        })                                                                     
      })
  })
}

module.exports = Master
