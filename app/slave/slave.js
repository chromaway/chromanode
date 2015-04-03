/* globals Promise:true */

var fs = require('fs')
var http = require('http')
var https = require('https')
var Promise = require('bluebird')
var express = require('express')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var Storage = require('../../lib/storage')
var socket = require('./socket')

/**
 * @class Slave
 */
function Slave () {}

/**
 * @return {Promise}
 */
Slave.prototype.init = function () {
  var self = this

  var port = config.get('chromanode.port')
  var host = config.get('chromanode.host')

  return Promise.try(function () {
    self.storage = new Storage()
    return self.storage.init()
  })
  .then(function () {
    self.expressApp = express()

    if (config.get('chromanode.enableHTTPS') === false) {
      self.server = http.createServer(self.expressApp)
      return
    }

    var opts = {}
    opts.key = fs.readFileSync('etc/key.pem')
    opts.cert = fs.readFileSync('etc/cert.pem')
    self.server = https.createServer(opts, self.expressApp)
  })
  .then(function () {
    self.ios = require('socket.io')(self.server, {serveClient: false})
    socket.init(self.ios)

    require('./express')(self.expressApp)
    require('./routes')(self.expressApp)

    self.server = Promise.promisifyAll(self.server)
    return self.server.listen(port)
  })
  .then(function () {
    logger.info('Slave server listening %s:%s', host, port)
  })
}

module.exports = Slave
