import express from 'express'

import addresses from '../controllers/addresses'
import headers from '../controllers/headers'
import node from '../controllers/node'
import transactions from '../controllers/transactions'
import cc from '../controllers/cc'

export default {
  createRouter: () => {
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

    // colored coins
    router.post('/cc/getAllColoredCoins', cc.v2.getAllColoredCoins)
    router.post('/cc/getTxColorValues', cc.v2.getTxColorValues)

    return router
  }
}
