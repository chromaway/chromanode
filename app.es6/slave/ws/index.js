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
   * @param {Master} master
   */
  constructor (master) {
    this._ios = null

    master.on('block', (payload) => {
      // api_v1
      this._ios.sockets.in('new-block').emit('new-block', payload.hash, payload.height)
      this._sV1.in('new-block').emit('new-block', payload.hash, payload.height)

      // api_v2
      this._sV2.in('new-block').emit('new-block', payload)
    })

    master.on('tx', (payload) => {
      // api_v1
      this._ios.sockets.in('new-tx').emit('new-tx', payload.txid)
      this._sV1.in('new-tx').emit('new-tx', payload.txid)

      // api_v2
      this._sV2.in('new-tx').emit('new-tx', payload)
      this._sV2.in(`tx-${payload.txid}`).emit('tx', payload)
    })

    master.on('address', (payload) => {
      // api_v1
      this._ios.sockets.in(payload.address).emit(payload.address, payload.txid)
      this._sV1.in(payload.address).emit(payload.address, payload.txid)

      // api_v2
      this._sV2.in(`address-${payload.address}`).emit('address', payload)
    })

    master.on('status', (payload) => {
      // api_v1
      // api_v2
      this._sV2.in('status').emit('status', payload)
    })
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
    let networkName = config.get('chromanode.network')
    if (networkName === 'regtest') {
      networkName = 'testnet'
    }

    /**
     * @param {string} eventName
     * @param {string} handlerName
     */
    function createRoomHandler (eventName, handlerName) {
      let handler = PUtils.promisify(::socket[handlerName])

      socket.on(eventName, (opts) => {
        PUtils.try(() => {
          let room = opts.type

          // type check
          let rooms = ['new-block', 'new-tx', 'tx', 'address', 'status']
          if (rooms.indexOf(opts.type) === -1) {
            throw new Error('wrong type')
          }

          // tx check
          if (room === 'tx') {
            if (!/^[0-9a-fA-F]{64}$/.test(opts.txid)) {
              throw new Error('Wrong txid')
            }

            room = 'tx-' + opts.txid
          }

          // address check
          if (room === 'address') {
            try {
              Address.fromString(opts.address, networkName)
            } catch (err) {
              throw new Error(`Wrong address (${err.message})`)
            }

            room = 'address-' + opts.address
          }

          return handler(room)
        })
        .catch((err) => {
          logger.error(`Socket (${socket.id}) ${eventName} error: ${err.stack}`)
          return err.message || err
        })
        .then((err) => {
          socket.emit(`${eventName}d`, opts, err || null)
        })
      })
    }

    createRoomHandler('subscribe', 'join')
    createRoomHandler('unsubscribe', 'leave')
  }
}
