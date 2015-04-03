var io = require('socket.io')

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

    socket.on('subscribe', function (room) {
      socket.join(room)
      socket.emit('subscribed', room)
    })

    socket.on('disconnect', function () {
      logger.verbose('disconnected %s', socket.id)
    })
  })
}

/**
 * @param {string} blockid
 * @param {number} height
 */
SocketIO.prototype.broadcastBlockId = function (blockid, height) {
  this.ios.sockets.in('new-block').emit('new-block', blockid, height)
}

/**
 * @param {string} address
 * @param {string} txid
 */
SocketIO.prototype.broadcastAddressTxId = function (address, txid) {
  this.ios.sockets.in(address).emit(address, txid)
}

module.exports = require('soop')(SocketIO)
