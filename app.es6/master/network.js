import _ from 'lodash'
import { EventEmitter } from 'events'
import { setImmediate } from 'timers'
import readyMixin from 'ready-mixin'
import bitcore from 'bitcore'
import p2p from 'bitcore-p2p'
import RpcClient from 'bitcoind-rpc-client'

import config from '../lib/config'
import errors from '../lib/errors'
import logger from '../lib/logger'
import util from '../lib/util'

/**
 * @event Network#block
 * @param {string} hash
 */

/**
 * @event Network#tx
 * @param {string} txid
 */

/**
 * @class Network
 */
export default class Network extends EventEmitter {
  /**
   * @constructor
   */
  constructor () {
    super()

    Promise.all([
      this._initBitcoind(),
      this._initTrustedPeer()
    ])
    .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Network ready ...') })
  }

  /**
   * @return {Promise}
   */
  async _initBitcoind () {
    // create rpc client
    this._bitcoind = new RpcClient({
      host: config.get('bitcoind.rpc.host'),
      port: config.get('bitcoind.rpc.port'),
      user: config.get('bitcoind.rpc.user'),
      pass: config.get('bitcoind.rpc.pass'),
      ssl: config.get('bitcoind.rpc.protocol') === 'https'
    })

    // request info
    let {result} = await this._bitcoind.getInfo()

    // check network
    let bitcoindNetwork = result.testnet ? 'testnet' : 'livenet'
    let chromanodeNetwork = config.get('chromanode.network')
    if (bitcoindNetwork !== chromanodeNetwork &&
        !(bitcoindNetwork === 'livenet' && chromanodeNetwork === 'regtest')) {
      throw new errors.InvalidBitcoindNetwork(bitcoindNetwork, chromanodeNetwork)
    }

    // show info
    logger.info(
      `Bitcoind checked. (version ${result.version}, bestHeight: ${result.blocks}, connections: ${result.connections})`)
  }

  /**
   * @return {Promise}
   */
  _initTrustedPeer () {
    // create trusted peer
    this._peer = new p2p.Peer({
      host: config.get('bitcoind.peer.host'),
      port: config.get('bitcoind.peer.port'),
      network: config.get('chromanode.network')
    })

    setImmediate(::this._peer.connect)

    // inv event
    this._peer.on('inv', (message) => {
      let names = []

      for (let inv of message.inventory) {
        // store inv type name
        names.push(p2p.Inventory.TYPE_NAME[inv.type])

        // store inv if tx type
        if (inv.type === p2p.Inventory.TYPE.TX) {
          this.emit('tx', util.encode(inv.hash))
        }

        // emit block if block type
        if (inv.type === p2p.Inventory.TYPE.BLOCK) {
          this.emit('block', util.encode(inv.hash))
        }
      }

      logger.verbose(
        `Receive inv (${names.join(', ')}) message from peer ${this._peer.host}:${this._peer.port}`)
    })

    // connect event
    this._peer.on('connect', () => {
      logger.info(`Connected to peer ${this._peer.host}:${this._peer.port}`)
    })

    // disconnect event
    this._peer.on('disconnect', () => {
      logger.info(`Disconnected from peer ${this._peer.host}:${this._peer.port}`)
    })

    // ready event
    this._peer.on('ready', () => {
      logger.info(
        `Peer ${this._peer.host}:${this._peer.port} is ready (version: ${this._peer.version}, subversion: ${this._peer.subversion}, bestHeight: ${this._peer.bestHeight})`)
    })

    // waiting peer ready
    return new Promise((resolve) => {
      this._peer.once('ready', resolve)
    })
  }

  /**
   * @return {Promise<Object>}
   */
  async getBitcoindInfo () {
    let {result} = await this._bitcoind.getInfo()
    return result
  }

  /**
   * @return {Promise<number>}
   */
  async getBlockCount () {
    let {result} = await this._bitcoind.getBlockCount()
    return result
  }

  /**
   * @param {number} height
   * @return {Promise<string>}
   */
  async getBlockHash (height) {
    let {result} = await this._bitcoind.getBlockHash(height)
    return result
  }

  /**
   * @param {(number|string)} hash
   * @return {Promise<bitcore.Block>}
   */
  async getBlock (hash) {
    if (_.isNumber(hash)) {
      hash = await this.getBlockHash(hash)
    }

    let {result} = await this._bitcoind.getBlock(hash, false)
    let rawBlock = new Buffer(result, 'hex')
    return new bitcore.Block(rawBlock)
  }

  /**
   * @return {Promise<{hash: string, height: number}>}
   */
  async getLatest () {
    let height = await this.getBlockCount()
    let hash = await this.getBlockHash(height)
    return {hash: hash, height: height}
  }

  /**
   * @param {string} txid
   * @return {Promise<bitcore.Transaction>}
   */
  async getTx (txid) {
    let {result} = await this._bitcoind.getRawTransaction(txid)
    let rawtx = new Buffer(result, 'hex')
    return new bitcore.Transaction(rawtx)
  }

  /**
   * @param {string} rawtx
   * @return {Promise}
   */
  async sendTx (rawtx) {
    await this._bitcoind.sendRawTransaction(rawtx)
  }

  /**
   * @return {Promise<string[]>}
   */
  async getMempoolTxs () {
    let {result} = await this._bitcoind.getRawMemPool()
    return result
  }
}

readyMixin(Network.prototype)
