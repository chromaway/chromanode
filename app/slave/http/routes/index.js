var express = require('express')

module.exports.createRouter = function () {
  var router = express.Router()

  router.use('/v1', require('./v1').createRouter())

  return router
}
