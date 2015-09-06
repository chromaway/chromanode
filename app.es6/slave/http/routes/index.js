'use strict'

var express = require('express')

var node = require('../controllers/node')

module.exports.createRouter = function () {
  var router = express.Router()

  router.use('/v1', require('./v1').createRouter())
  router.use('/v2', require('./v2').createRouter())
  router.use('/version', node.version)

  return router
}
