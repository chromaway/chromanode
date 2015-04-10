/* globals Promise:true */

var bodyParser = require('body-parser')
var cors = require('cors')
var compression = require('compression')
var express = require('express')
var expressWinston = require('express-winston')
var fs = require('fs')
var http = require('http')
var https = require('https')
var Promise = require('bluebird')

var config = require('../../../lib/config')
var errors = require('../../../lib/errors')
var logger = require('../../../lib/logger').logger
var routes = require('./routes')

express.response.jsend = function (data) {
  this.jsonp({status: 'success', data: data})
}

express.response.jfail = function (data) {
  this.jsonp({status: 'fail', data: data})
}

express.response.jerror = function (message) {
  this.jsonp({status: 'error', message: message})
}

express.response.promise = function (promise) {
  var self = this
  promise
    .then(self.jsend.bind(self))
    .catch(errors.Slave.SendTxError, function (err) {
      // special case
      self.jfail({
        type: err.name.slice(20),
        code: err.data.code,
        message: err.data.message
      })
    })
    .catch(errors.Slave, function (err) {
      // logger.info('Invalid query: %s', err.name)
      // cut ErrorChromanodeSlave
      self.jfail({type: err.name.slice(20)})
    })
    .catch(function (err) {
      logger.error(err)
      self.jerror(err.message)
    })
}

module.exports.createServer = function (expressApp) {
  var server = (function () {
    if (!!config.get('chromanode.enableHTTPS') === false) {
      return http.createServer(expressApp)
    }

    var opts = {}
    opts.key = fs.readFileSync('etc/key.pem')
    opts.cert = fs.readFileSync('etc/cert.pem')
    return https.createServer(opts, expressApp)
  })()

  return Promise.promisifyAll(server)
}

module.exports.setupExpress = function (app) {
  // app.set('showStackError', true)
  app.set('etag', false)

  app.enable('jsonp callback')

  app.use(cors())
  app.use(compression())
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({extended: true}))

  app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization')
    res.setHeader('Access-Control-Expose-Headers', 'X-Email-Needs-Validation,X-Quota-Per-Item,X-Quota-Items-Limit,X-RateLimit-Limit,X-RateLimit-Remaining')
    next()
  })

  app.use(expressWinston.logger({
    winstonInstance: logger,
    meta: false,
    expressFormat: true,
    colorStatus: true
  }))

  app.use('/', routes.createRouter())

  app.use(function (req, res) {
    res.jfail('The endpoint you are looking for does not exist!')
  })
}
