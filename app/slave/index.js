var express = require('express')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var http = require('./http')
var socket = require('./ws').default()
var storage = require('../../lib/storage').default()

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var port = config.get('chromanode.port')
  var host = config.get('chromanode.host')

  return storage.init()
    .then(function () {
      var expressApp = express()
      http.setupExpress(expressApp)

      var server = http.createServer(expressApp)
      socket.attach(server)

      return server.listen(port, host)
    })
    .then(function () {
      logger.info('Slave server listening %s:%s', host, port)
    })
}
