'use strict'

var express = require('express')
var Promise = require('bluebird')

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
    var socket = new SocketIO(master)

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
      var server = http.createServer(expressApp)

      http.setup(expressApp, storage, master)
      socket.attach(server)

      return server.listen(port)
    })
    .then(function () {
      logger.info('Slave server listening port %s', port)
    })
  })
}
