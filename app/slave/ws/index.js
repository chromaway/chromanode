var logger = require('../../../lib/logger').logger

var ios = null // global is not good?

/**
 * @param {socketio.Server} _ios
 */
module.exports.init = function (_ios) {
  ios = _ios
  ios.sockets.on('connection', function (socket) {
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
module.exports.broadcastBlockId = function (blockid, height) {
  ios.sockets.in('new-block').emit('new-block', blockid, height)
}

/**
 * @param {string} address
 * @param {string} txid
 */
module.exports.broadcastAddressTxId = function (address, txid) {
  ios.sockets.in(address).emit(address, txid)
}
