var expressWinston = require('express-winston')
var bodyParser = require('body-parser')
var compression = require('compression')

var logger = require('../../../lib/logger').logger

module.exports = function (app) {
  app.set('showStackError', true)
  app.set('etag', false)

  app.enable('jsonp callback')

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
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({extended: true}))
  app.use(compression())

  /** @todo 404 handler */
}
