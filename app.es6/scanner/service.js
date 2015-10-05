import _ from 'lodash'
import { EventEmitter } from 'events'
import PUtils from 'promise-useful-utils'
import { mixin } from 'core-decorators'
import ReadyMixin from 'ready-mixin'

import logger from '../lib/logger'

/**
 * @event Service#sendTx
 * @param {string} id
 * @param {string} rawtx
 */

/**
 * @class Service
 * @extends EventEmitter
 */
@mixin(ReadyMixin)
export default class Service extends EventEmitter {
  /**
   * @param {Messages} messages
   */
  constructor (messages) {
    super()

    this.messages = messages

    PUtils.try(async () => {
      await this.messages.ready
      await this.messages.listen('sendtx', (payload) => {
        this.emit('sendTx', payload.id)
      })
    })
    .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Service ready ...') })
  }

  /**
   * @param {string} id
   * @param {?Object} err
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  sendTxResponse (id, err, opts) {
    return this.messages.notify('sendtxresponse', {
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
    return this.messages.notify('broadcastblock', {
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
    return this.messages.notify('broadcasttx', {
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
    return this.messages.notify('broadcastaddress', {
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
    return this.messages.notify('broadcaststatus', status, opts)
  }

  /**
   * @param {string} txid
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  addTx (txid, opts) {
    return this.messages.notify('addtx', {txid: txid}, opts)
  }

  /**
   * @param {string} txid
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  removeTx (txid, opts) {
    return this.messages.notify('removetx', {txid: txid}, opts)
  }

  /**
   * @param {string} hash
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  addBlock (hash, opts) {
    return this.messages.notify('addblock', {hash: hash}, opts)
  }

  /**
   * @param {string} hash
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  removeBlock (hash, opts) {
    return this.messages.notify('removeblock', {hash: hash}, opts)
  }
}
