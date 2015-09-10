import express from 'express'

import addresses from '../controllers/addresses'
import headers from '../controllers/headers'
import transactions from '../controllers/transactions'

export function createRouter () {
  let router = express.Router()

  // header routes
  router.get('/headers/latest', headers.v1.latest)
  router.get('/headers/query', headers.v1.query)

  // transaction routes
  router.get('/transactions/raw', transactions.v1.raw)
  router.get('/transactions/merkle', transactions.v1.merkle)
  router.post('/transactions/send', transactions.v1.send)

  // address routes
  router.get('/addresses/query', addresses.v1.query)

  return router
}
