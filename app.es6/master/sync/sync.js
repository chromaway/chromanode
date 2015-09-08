import _ from 'lodash'
import { EventEmitter } from 'events'
import bitcore from 'bitcore'
import ElapsedTime from 'elapsed-time'

import config from '../../lib/config'
import logger from '../../lib/logger'
import { ZERO_HASH } from '../../lib/const'
import util from '../../lib/util'
import SQL from '../sql'

let Address = bitcore.Address
let Hash = bitcore.crypto.Hash

/**
 * @event Sync#latest
 * @param {{hash: string, height: number}} latest
 */

/**
 * @event Sync#tx
 * @param {string} txid
 */

/**
 * @class Sync
 * @extends events.EventEmitter
 */
export default class Sync extends EventEmitter {
  /**
   * @constructor
   * @param {Storage} storage
   * @param {Messages} messages
   * @param {Network} network
   * @param {Slaves} slaves
   */
  constructor (storage, messages, network, slaves) {
    super()

    this._storage = storage
    this._messages = messages
    this._network = network
    this._slaves = slaves

    let networkName = config.get('chromanode.network')
    this._bitcoinNetwork = bitcore.Networks.get(networkName)

    this._latest = null
    this._blockchainLatest = null
  }

  /**
   * @param {Buffer} buf
   * @param {string} type
   * @return {string}
   */
  _createAddress (buf, type) {
    let address = new Address(buf, this._bitcoinNetwork, type)
    return address.toString()
  }

  /**
   * @param {bitcore.Script} script
   * @return {string[]}
   */
  _getAddresses (script) {
    if (script.isPublicKeyHashOut()) {
      return [
        this._createAddress(script.chunks[2].buf, Address.PayToPublicKeyHash)
      ]
    }

    if (script.isScriptHashOut()) {
      return [
        this._createAddress(script.chunks[1].buf, Address.PayToScriptHash)
      ]
    }

    if (script.isMultisigOut()) {
      return script.chunks.slice(1, -2).map((chunk) => {
        let hash = Hash.sha256ripemd160(chunk.buf)
        return this._createAddress(hash, Address.PayToPublicKeyHash)
      })
    }

    if (script.isPublicKeyOut()) {
      let hash = Hash.sha256ripemd160(script.chunks[0].buf)
      return [
        this._createAddress(hash, Address.PayToPublicKeyHash)
      ]
    }

    return []
  }

  /**
   * @param {bitcore.Transaction.Output} output
   * @param {string} txid
   * @param {number} index
   * @return {string[]}
   */
  _safeGetAddresses (output, txid, index) {
    try {
      return this._getAddresses(output.script)
    } catch (err) {
      logger.error(`On get addresses for output ${txid}:${index} ${err.stack}`)
      return []
    }
  }

  /**
   * @return {Promise<boolean>}
   */
  _updateChain () {
    if (this._latest.hash === this._blockchainLatest.hash) {
      return Promise.resolve(false)
    }

    let stopwatch = new ElapsedTime()
    let latest = _.clone(this._latest)
    return this._storage.executeTransaction(async (client) => {
      let block
      while (true) {
        stopwatch.reset().start()
        block = await this._network.getBlock(latest.height + 1)
        logger.verbose(`Downloading block ${latest.height + 1}, elapsed time: ${stopwatch.getValue()}`)

        if (latest.hash === util.encode(block.header.prevHash)) {
          break
        }

        // don't remove? make unconfirmed?
        let queries = [
          SQL.delete.blocks.fromHeight,
          SQL.delete.transactions.fromHeight,
          SQL.delete.history.fromHeight,
          SQL.update.history.deleteInputsFromHeight
        ]
        let to = Math.min(latest.height - 1, this._blockchainLatest.height - 1)

        stopwatch.reset().start()
        for (let query of queries) {
          await client.queryAsync(query, [to])
        }
        logger.warn(`Reorg finished (back to ${to}), elapsed time: ${stopwatch.getValue()}`)

        latest = await this._getLatest({client: client})
      }

      stopwatch.reset().start()
      await this._importBlock(block, latest.height + 1, client)
      logger.verbose(`Import block #${latest.height + 1}, elapsed time: ${stopwatch.getValue()} (hash: ${this._latest.hash})`)

      // new latest
      this._latest = await this._getLatest({client: client})

      return true
    })
  }

  /**
   * @param {Objects} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise<{hash: string, height: number}>}
   */
  _getLatest (opts) {
    let execute = ::this._storage.executeTransaction
    if (_.has(opts, 'client')) {
      execute = (fn) => { return fn(opts.client) }
    }

    return execute(async (client) => {
      let result = await client.queryAsync(SQL.select.blocks.latest)
      if (result.rowCount === 0) {
        return {hash: ZERO_HASH, height: -1}
      }

      let row = result.rows[0]
      return {hash: row.hash.toString('hex'), height: row.height}
    })
  }
}
