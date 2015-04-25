var express = require('express')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var http = require('./http')
var SocketIO = require('./ws')
var Master = require('./master')
var Storage = require('../../lib/storage')

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var port = config.get('chromanode.port')

  return Promise.try(function () {
    var storage = new Storage()
    var master = new Master(storage)
    var socket = new SocketIO()

    return Promise.all([
      storage.init()
    ])
    .then(function () {
      return Promise.all([
        master.init()
      ])
    })
    .then(function () {
      var expressApp = express()
      http.setupExpress(expressApp)

      var server = http.createServer(expressApp)
      socket.attach(server)

      master.on('block', function (hash, height) {
        socket.broadcastBlock(hash, height)
      })

      master.on('tx', function (txid, blockHash, blockHeight) {
        socket.broadcastTx(txid, blockHash, blockHeight)
      })

      master.on('address', function (address, txid, blockHash, blockHeight) {
        socket.broadcastAddress(address, txid, blockHash, blockHeight)
      })

      master.on('status', function (status) {
        socket.broadcastStatus(status)
      })

      return server.listen(port)
    })
    .then(function () {
      logger.info('Slave server listening port %s', port)
    })
  })
}
