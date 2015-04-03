var express = require('express')

module.exports.createRoutes = function () {
  var router = express.Router()

  router.use('/v1', require('./v1').createRoutes())

  return router
}
