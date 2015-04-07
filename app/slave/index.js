var express = require('express')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var http = require('./http')
var socket = require('./ws').default()
var master = require('./master').default()
var messages = require('../../lib/messages').default()
var storage = require('../../lib/storage').default()

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var port = config.get('chromanode.port')
  var host = config.get('chromanode.host')

  return storage.init()
    .then(function () { return messages.init() })
    .then(function () { return master.init() })
    .then(function () {
      var expressApp = express()
      http.setupExpress(expressApp)

      var server = http.createServer(expressApp)
      socket.attach(server)

      master.on('addressTouched', function (address, txid) {
        socket.broadcastAddressTxId(address, txid)
      })

      master.on('newBlock', function (blockid, height) {
        socket.broadcastBlockId(blockid, height)
      })

      return server.listen(port, host)
    })
    .then(function () {
      logger.info('Slave server listening %s:%s', host, port)
    })
}
