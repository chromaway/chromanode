/* globals Promise:true */

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
    self._ios.sockets.in('new-block').emit('new-block', payload)
  })

  master.on('tx', function (payload) {
    self._ios.sockets.in('new-tx').emit('new-tx', payload)
    self._ios.sockets.in('tx-' + payload.txid).emit('tx', payload)
  })

  master.on('address', function (payload) {
    self._ios.sockets.in('address-' + payload.address).emit('address', payload)
  })

  master.on('status', function (payload) {
    self._ios.sockets.in('status').emit('status', payload)
  })
}

/**
 */
SocketIO.prototype.attach = function (server) {
  var self = this
  self._ios = io(server, {serveClient: false})
  self._ios.sockets.on('connection', function (socket) {
    logger.verbose('New connection from %s', socket.id)

    socket.on('disconnect', function () {
      logger.verbose('disconnected %s', socket.id)
    })

    /**
     * @param {string} event
     * @param {string} handler
     */
    function createRoomHandler (event, handler) {
      handler = Promise.promisify(socket[handler].bind(socket))

      socket.on(event, function (opts) {
        self._getRoom(opts)
          .then(function (room) {
            return handler(room)
          })
          .catch(function (err) {
            return err.message || err
          })
          .then(function (err) {
            socket.emit(event, opts, err || null)
          })
      })
    }

    createRoomHandler('subscribe', 'join')
    createRoomHandler('unsubscribe', 'leave')
  })
}

/**
 * @param {Object} opts
 * @return {Promise<string>}
 */
SocketIO.prototype._getRoom = function (opts) {
  return Promise.try(function () {
    var room = opts.type

    // type check
    var rooms = ['new-block', 'new-tx', 'tx', 'address', 'status']
    if (rooms.indexOf(opts.room) === -1) {
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
  })
}

module.exports = SocketIO
