'use strict'

var io = require('socket.io')
var Address = require('bitcore').Address

var Promise = require('bluebird')

var config = require('../../../lib/config')
var logger = require('../../../lib/logger').logger

/**
 * @class SocketIO
 * @param {Master} master
 */
function SocketIO (master) {
  var self = this
  self._ios = null

  master.on('block', function (payload) {
    // api_v1
    var hash = payload.hash
    var height = payload.height
    self._ios.sockets.in('new-block').emit('new-block', hash, height)
    self._sV1.in('new-block').emit('new-block', hash, height)

    // api_v2
    self._sV2.in('new-block').emit('new-block', payload)
  })

  master.on('tx', function (payload) {
    // api_v1
    self._ios.sockets.in('new-tx').emit('new-tx', payload.txid)
    self._sV1.in('new-tx').emit('new-tx', payload.txid)

    // api_v2
    self._sV2.in('new-tx').emit('new-tx', payload)
    self._sV2.in('tx-' + payload.txid).emit('tx', payload)
  })

  master.on('address', function (payload) {
    // api_v1
    self._ios.sockets.in(payload.address).emit(payload.address, payload.txid)
    self._sV1.in(payload.address).emit(payload.address, payload.txid)

    // api_v2
    self._sV2.in('address-' + payload.address).emit('address', payload)
  })

  master.on('status', function (payload) {
    // api_v1
    // api_v2
    self._sV2.in('status').emit('status', payload)
  })
}

/**
 */
SocketIO.prototype.attach = function (server) {
  var self = this

  self._ios = io(server, {serveClient: false})

  // witout namespace: write socket.id to log and call v1
  self._ios.on('connection', function (socket) {
    logger.verbose('New connection from %s', socket.id)

    socket.on('disconnect', function () {
      logger.verbose('disconnected %s', socket.id)
    })

    self._onV1Connection(socket)
  })

  // api_v1
  self._sV1 = self._ios.of('/v1')
  self._sV1.on('connection', self._onV1Connection.bind(self))

  // api_v2
  self._sV2 = self._ios.of('/v2')
  self._sV2.on('connection', self._onV2Connection.bind(self))
}

/**
 * @param {socket.io.Socket} socket
 */
SocketIO.prototype._onV1Connection = function (socket) {
  socket.on('subscribe', function (room) {
    socket.join(room)
    socket.emit('subscribed', room)
  })
}

/**
 * @param {socket.io.Socket} socket
 */
SocketIO.prototype._onV2Connection = function (socket) {
  /**
   * @param {string} event
   * @param {string} handler
   */
  function createRoomHandler (event, handler) {
    handler = Promise.promisify(socket[handler].bind(socket))

    socket.on(event, function (opts) {
      return Promise.try(function () {
        var room = opts.type

        // type check
        var rooms = ['new-block', 'new-tx', 'tx', 'address', 'status']
        if (rooms.indexOf(opts.type) === -1) {
          throw new Error('wrong type')
        }

        // tx check
        if (room === 'tx') {
          if (/^[0-9a-fA-F]{64}$/.test(opts.txid)) {
            throw new Error('Wrong txid')
          }

          room = 'tx-' + opts.txid
        }

        // address check
        if (room === 'address') {
          try {
            Address.fromString(opts.address, config.get('chromanode.network'))
          } catch (err) {
            throw new Error('Wrong address (' + err.message + ')')
          }

          room = 'address-' + opts.address
        }

        return handler(room)
      })
      .catch(function (err) {
        logger.error('Socket (%s) %s error: %s', socket.id, event, err)
        return err.message || err
      })
      .then(function (err) {
        socket.emit(event, opts, err || null)
      })
    })
  }

  createRoomHandler('subscribe', 'join')
  createRoomHandler('unsubscribe', 'leave')
}

module.exports = SocketIO
