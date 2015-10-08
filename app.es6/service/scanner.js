import _ from 'lodash'
import { EventEmitter } from 'events'
import { mixin } from 'core-decorators'
import ReadyMixin from 'ready-mixin'

import errors from '../lib/errors'
import logger from '../lib/logger'
import SQL from '../lib/sql'

/**
 * @event Scanner#block
 * @param {Object} payload
 * @param {string} payload.hash
 * @param {number} payload.height
 */

/**
 * @event Scanner#tx
 * @param {Object} payload
 * @param {string} payload.txId
 * @param {?string} payload.blockHash
 * @param {?string} payload.blockHeight
 */

/**
 * @event Scanner#address
 * @param {Object} payload
 * @param {string} payload.address
 * @param {string} payload.txId
 * @param {?string} payload.blockHash
 * @param {?string} payload.blockHeight
 */

/**
 * @event Scanner#status
 * @param {Object} status
 */

/**
 * @class Scanner
 */
@mixin(ReadyMixin)
export default class Scanner extends EventEmitter {
  /**
   * @constructor
   * @param {Storage} storage
   * @param {Messages} mNotifications
   * @param {Messages} mSendTx
   */
  constructor (storage, mNotifications, mSendTx) {
    super()

    this._storage = storage
    this._mNotifications = mNotifications
    this._mSendTx = mSendTx

    this._sendTxDeferreds = {}

    this._lastStatus = new Promise((resolve) => {
      let isResolved = false
      this.on('status', (status) => {
        if (isResolved) {
          this._lastStatus = Promise.resolve(status)
          return
        }

        resolve(status)
        isResolved = true
      })
    })

    Promise.all([
      this._storage.ready,
      this._mNotifications.ready,
      this._mSendTx.ready
    ])
    .then(() => {
      /**
       * @param {string} channel
       * @param {string} handler
       * @return {Promise}
       */
      let listen = (messages, channel, handler) => {
        if (_.isString(handler)) {
          let eventName = handler
          handler = (payload) => this.emit(eventName, payload)
        }

        return messages.listen(channel, handler)
      }

      return Promise.all([
        listen(this._mNotifications, 'broadcastblock', 'block'),
        listen(this._mNotifications, 'broadcasttx', 'tx'),
        listen(this._mNotifications, 'broadcastaddress', 'address'),
        listen(this._mNotifications, 'broadcaststatus', 'status'),
        listen(this._mSendTx, 'sendtxresponse', ::this._onSendTxResponse)
      ])
    })
    .then(() => this._ready(null), (err) => this._ready(err))

    this.ready
      .then(() => logger.info('Scanner ready ...'))
  }

  /**
   * @return {Promise<Object>}
   */
  getStatus () {
    return this._lastStatus
  }

  /**
   * @param {Object} payload
   */
  _onSendTxResponse (payload) {
    let defer = this._sendTxDeferreds[payload.id]
    if (defer === undefined) {
      return
    }

    delete this._sendTxDeferreds[payload.id]
    if (payload.status === 'success') {
      return defer.resolve()
    }

    let err = new errors.Service.SendTxError()
    err.data = {code: payload.code, message: unescape(payload.message)}
    return defer.reject(err)
  }

  /**
   * @param {string} rawtx
   * @return {Promise}
   */
  async sendTx (rawtx) {
    let process

    await this._storage.executeTransaction(async (client) => {
      let result = await client.queryAsync(SQL.insert.newTx.row, [`\\x${rawtx}`])
      let id = result.rows[0].id

      await this._mSendTx.notify('sendtx', {id: id}, {client: client})

      process = new Promise((resolve, reject) => {
        this._sendTxDeferreds[id] = {resolve: resolve, reject: reject}
      })
    })

    await process
  }
}
