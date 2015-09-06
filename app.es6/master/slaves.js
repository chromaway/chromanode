import _ from 'lodash'
import { EventEmitter } from 'events'
import PUtils from 'promise-useful-utils'
import readyMixin from 'ready-mixin'

import logger from '../lib/logger'

/**
 * @event Slaves#sendTx
 * @param {string} id
 * @param {string} rawtx
 */

/**
 * @class Slaves
 */
export default class Slaves extends EventEmitter {
  /**
   * @param {Messages} messages
   */
  constructor (messages) {
    super()

    this.messages = messages

    PUtils.try(async () => {
      await this.messages.ready
      await this.messages.listen('sendtx', (payload) => {
        payload = JSON.parse(payload)
        this.emit('sendTx', payload.id)
      })
    })
    .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Slaves ready ...') })
  }

  /**
   * @param {string} channel
   * @param {Object} obj
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  notify (channel, obj, opts) {
    return this.messages.notify(channel, JSON.stringify(obj), opts)
  }

  /**
   * @param {string} id
   * @param {?Object} err
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  sendTxResponse (id, err, opts) {
    return this.notify('sendtxresponse', {
      id: id,
      status: err === null ? 'success' : 'fail',
      code: _.get(err, 'code'),
      message: escape(_.get(err, 'message'))
    }, opts)
  }

  /**
   * @param {string} hash
   * @param {number} height
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  broadcastBlock (hash, height, opts) {
    return this.notify('broadcastblock', {
      hash: hash,
      height: height
    }, opts)
  }

  /**
   * @param {string} txid
   * @param {?string} blockHash
   * @param {?number} blockHeight
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  broadcastTx (txid, blockHash, blockHeight, opts) {
    return this.notify('broadcasttx', {
      txid: txid,
      blockHash: blockHash,
      blockHeight: blockHeight
    }, opts)
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
  broadcastAddress (address, txid, blockHash, blockHeight, opts) {
    return this.notify('broadcastaddress', {
      address: address,
      txid: txid,
      blockHash: blockHash,
      blockHeight: blockHeight
    }, opts)
  }

  /**
   * @param {Object} status
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  broadcastStatus (status, opts) {
    return this.notify('broadcaststatus', status, opts)
  }
}

readyMixin(Slaves.prototype)
