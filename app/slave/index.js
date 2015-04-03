/* globals Promise:true */

var fs = require('fs')
var http = require('http')
var https = require('https')
var Promise = require('bluebird')
var express = require('express')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var Storage = require('../../lib/storage')
var socket = require('./ws')

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var port = config.get('chromanode.port')
  var host = config.get('chromanode.host')

  var storage
  var expressApp
  var server
  var ios

  return Promise.try(function () {
    storage = new Storage()
    return storage.init()
  })
  .then(function () {
    expressApp = express()

    if (config.get('chromanode.enableHTTPS') === false) {
      server = http.createServer(expressApp)
      return
    }

    var opts = {}
    opts.key = fs.readFileSync('etc/key.pem')
    opts.cert = fs.readFileSync('etc/cert.pem')
    server = https.createServer(opts, expressApp)
  })
  .then(function () {
    ios = require('socket.io')(server, {serveClient: false})
    socket.init(ios)

    require('./http')(expressApp)
    require('./http/routes/v1')(expressApp)

    server = Promise.promisifyAll(server)
    return server.listen(port)
  })
  .then(function () {
    logger.info('Slave server listening %s:%s', host, port)
  })
}
