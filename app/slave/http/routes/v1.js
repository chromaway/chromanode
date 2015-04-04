var express = require('express')

var addresses = require('../controllers/addresses')
var headers = require('../controllers/headers')
var node = require('../controllers/node')
var transactions = require('../controllers/transactions')

module.exports.createRouter = function () {
  var router = express.Router()

  // node routes
  router.get('/status', node.status)

  // header routes
  router.get('/headers/latest', headers.latest)
  router.get('/headers/query', headers.query)

  // transaction routes
  router.get('/transactions/raw', transactions.raw)
  router.get('/transactions/merkle', transactions.merkle)
  router.get('/transactions/send', transactions.send)

  // address routes
  router.get('/addresses/query', addresses.query)

  return router
}
