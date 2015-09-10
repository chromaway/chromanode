import express from 'express'

import node from '../controllers/node'

export default {
  createRouter: () => {
    let router = express.Router()

    router.use('/v1', require('./v1').createRouter())
    router.use('/v2', require('./v2').createRouter())
    router.use('/version', node.version)

    return router
  }
}
