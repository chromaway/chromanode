import _ from 'lodash'
import { EventEmitter } from 'events'
import readyMixin from 'ready-mixin'

import errors from '../lib/errors'
import logger from '../lib/logger'
import SQL from './sql'

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
 */
export default class Master extends EventEmitter {
  /**
   * @constructor
   * @param {Storage} storage
   * @param {Messages} messages
   */
  constructor (storage, messages) {
    super()

    this._storage = storage
    this._messages = messages

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

    Promise.all([this._storage.ready, this._messages.ready])
      .then(() => {
        /**
         * @param {string} channel
         * @param {string} handler
         * @return {Promise}
         */
        let listen = (channel, handler) => {
          if (_.isString(handler)) {
            let eventName = handler
            handler = (payload) => { this.emit(eventName, payload) }
          }

          return this._messages.listen(channel, handler)
        }

        return Promise.all([
          listen('broadcastblock', 'block'),
          listen('broadcasttx', 'tx'),
          listen('broadcastaddress', 'address'),
          listen('broadcaststatus', 'status'),
          listen('sendtxresponse', ::this._onSendTxResponse)
        ])
      })
      .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Master ready ...') })
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

    let err = new errors.Slave.SendTxError()
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
      let result = await client.queryAsync(SQL.insert.newTx.row, ['\\x' + rawtx])
      let id = result.rows[0].id

      await this._messages.notify('sendtx', {id: id}, {client: client})

      process = new Promise((resolve, reject) => {
        this._sendTxDeferreds[id] = {resolve: resolve, reject: reject}
      })
    })

    await process
  }
}

readyMixin(Master.prototype)
