import IO from 'socket.io'
import { Address } from 'bitcore'
import PUtils from 'promise-useful-utils'

import config from '../../lib/config'
import logger from '../../lib/logger'

/**
 * @class SocketIO
 */
export default class SocketIO {
  /**
   * @constructor
   * @param {Scanner} scanner
   */
  constructor (scanner) {
    this._networkName = config.get('chromanode.network')
    if (this._networkName === 'regtest') {
      this._networkName = 'testnet'
    }

    this._scanner = scanner
  }

  /**
   */
  attach (server) {
    this._ios = IO(server, {serveClient: false})

    // witout namespace: write socket.id to log and call v1
    this._ios.on('connection', (socket) => {
      logger.verbose(`New connection from ${socket.id}`)

      socket.on('disconnect', () => {
        logger.verbose(`disconnected ${socket.id}`)
      })

      this._onV1Connection(socket)
    })

    // api_v1
    this._sV1 = this._ios.of('/v1')
    this._sV1.on('connection', ::this._onV1Connection)

    // api_v2
    this._sV2 = this._ios.of('/v2')
    this._sV2.on('connection', ::this._onV2Connection)

    this._scanner.on('block', (payload) => {
      // api_v1
      this._ios.sockets.in('new-block').emit('new-block', payload.hash, payload.height)
      this._sV1.in('new-block').emit('new-block', payload.hash, payload.height)

      // api_v2
      let obj = {hash: payload.hash, height: payload.height}
      this._sV2.in('new-block').emit('new-block', obj)
    })

    this._scanner.on('tx', (payload) => {
      // api_v1
      this._ios.sockets.in('new-tx').emit('new-tx', payload.txId)
      this._sV1.in('new-tx').emit('new-tx', payload.txId)

      // api_v2
      let obj = {
        txid: payload.txId,
        blockHash: payload.blockHash,
        blockHeight: payload.blockHeight
      }
      this._sV2.in('new-tx').emit('new-tx', obj)
      this._sV2.in(`tx-${payload.txId}`).emit('tx', obj)
    })

    this._scanner.on('address', (payload) => {
      // api_v1
      this._ios.sockets.in(payload.address).emit(payload.address, payload.txId)
      this._sV1.in(payload.address).emit(payload.address, payload.txId)

      // api_v2
      let obj = {
        address: payload.address,
        txid: payload.txId,
        blockHash: payload.blockHash,
        blockHeight: payload.blockHeight
      }
      this._sV2.in(`address-${payload.address}`).emit('address', obj)
    })

    this._scanner.on('status', (payload) => {
      // api_v1
      // api_v2
      this._sV2.in('status').emit('status', payload)
    })
  }

  /**
   * @param {socket.io.Socket} socket
   */
  _onV1Connection (socket) {
    socket.on('subscribe', (room) => {
      socket.join(room)
      socket.emit('subscribed', room)
    })
  }

  /**
   * @param {socket.io.Socket} socket
   */
  _onV2Connection (socket) {
    let join = PUtils.promisify(::socket.join)
    socket.on('subscribe', async (opts) => {
      try {
        let room = this._v2GetRoom(opts)
        await join(room)
        socket.emit('subscribed', opts, null)
      } catch (err) {
        logger.error(`Socket (${socket.id}) subscribe error: ${err.stack}`)
        socket.emit('subscribed', opts, err.message || err)
      }
    })

    let leave = PUtils.promisify(::socket.leave)
    socket.on('unsubscribe', async (opts) => {
      try {
        let room = this._v2GetRoom(opts)
        await leave(room)
        socket.emit('unsubscribed', opts, null)
      } catch (err) {
        logger.error(`Socket (${socket.id}) unsubscribe error: ${err.stack}`)
        socket.emit('unsubscribed', opts, err.message || err)
      }
    })
  }

  /**
   * @param {Object} opts
   * @return {string}
   * @throws {Error}
   */
  _v2GetRoom (opts) {
    switch (opts.type) {
      case 'new-block':
        return 'new-block'

      case 'new-tx':
        return 'new-tx'

      case 'tx':
        if (!/^[0-9a-fA-F]{64}$/.test(opts.txid)) {
          throw new Error(`Wrong txid: ${opts.txid}`)
        }
        return `tx-${opts.txid}`

      case 'address':
        try {
          Address.fromString(opts.address, this._networkName)
        } catch (err) {
          throw new Error(`Wrong address: ${opts.address} (${err.message})`)
        }
        return `address-${opts.address}`

      case 'status':
        return 'status'

      default:
        throw new Error('wrong type')
    }
  }
}
