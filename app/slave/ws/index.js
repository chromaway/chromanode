var io = require('socket.io')
var Address = require('bitcore').Address

var config = require('../../lib/config')
var logger = require('../../../lib/logger').logger

/**
 * @class SocketIO
 */
function SocketIO () {
  this.ios = null
}

/**
 */
SocketIO.prototype.attach = function (server) {
  this.ios = io(server, {serveClient: false})
  this.ios.sockets.on('connection', function (socket) {
    logger.verbose('New connection from %s', socket.id)

    socket.on('subscribe', function (opts) {
      Promise.try(function () {
        var room = opts.type

        // type check
        if (['block', 'tx', 'address', 'status'].indexOf(opts.type) === -1) {
          throw new Error('wrong type')
        }

        // address check
        if (opts.type === 'address') {
          Address.fromString(opts.address, config.get('chromanode.network'))
          room += opts.address
        }

        socket.join(room)
      })
      .catch(function (err) {
        return err.message
      })
      .then(function (err) {
        socket.emit('subscribe', opts, err || null)
      })
    })

    socket.on('disconnect', function () {
      logger.verbose('disconnected %s', socket.id)
    })
  })
}

/**
 * @param {string} hash
 * @param {number} height
 */
SocketIO.prototype.broadcastBlock = function (hash, height) {
  this.ios.sockets.in('block').emit('block', hash, height)
}

/**
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?string} blockHeight
 */
SocketIO.prototype.broadcastTx = function (txid, blockHash, blockHeight) {
  this.ios.sockets.in('new-tx').emit('new-tx', txid)
}

/**
 * @param {string} address
 * @param {string} txid
 * @param {?string} blockHash
 * @param {?string} blockHeight
 */
SocketIO.prototype.broadcastAddressTouched = function (address, txid, blockHash, blockHeight) {
  this.ios.sockets.in(address).emit(address, txid)
}

/**
 * @param {Object} status
 */
SocketIO.prototype.broadcastStatus = function (status) {
  this.ios.sockets.in('status').emit('status', status)
}

module.exports = SocketIO
