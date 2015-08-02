var express = require('express')

var addresses = require('../controllers/addresses')
var headers = require('../controllers/headers')
var node = require('../controllers/node')
var transactions = require('../controllers/transactions')

module.exports.createRouter = function () {
  var router = express.Router()

  // node routes
  router.get('/status', node.v2.status)

  // header routes
  router.get('/headers/latest', headers.v2.latest)
  router.get('/headers/query', headers.v2.query)

  // transaction routes
  router.get('/transactions/raw', transactions.v2.raw)
  router.get('/transactions/merkle', transactions.v2.merkle)
  router.get('/transactions/spent', transactions.v2.spent)
  router.post('/transactions/send', transactions.v2.send)

  // address routes
  router.get('/addresses/query', addresses.v2.query)

  return router
}
