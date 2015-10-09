import bodyParser from 'body-parser'
import cors from 'cors'
import compression from 'compression'
import express from 'express'
import expressWinston from 'express-winston'
import fs from 'fs'
import http from 'http'
import https from 'https'
import PUtils from 'promise-useful-utils'

import config from '../../lib/config'
import errors from '../../lib/errors'
import logger from '../../lib/logger'
import routes from './routes'

express.response.jsend = function (data) {
  this.jsonp({status: 'success', data: data})
}

express.response.jfail = function (data) {
  this.jsonp({status: 'fail', data: data})
}

express.response.jerror = function (message) {
  this.jsonp({status: 'error', message: message})
}

express.response.promise = async function (promise) {
  try {
    let result = await promise
    this.jsend(result)
  } catch (err) {
    if (err instanceof errors.Service.SendTxError) {
      // special case
      this.jfail({
        type: err.name.slice(22),
        code: err.data.code,
        message: err.data.message
      })
      return
    }

    if (err instanceof errors.Service) {
      // logger.info(`Invalid query: ${err.name}`)
      // cut ErrorChromanodeService
      this.jfail({type: err.name.slice(22), message: err.message})
      return
    }

    logger.error(err.stack)
    this.jerror(err.message)
  }
}

export default function (app, storage, scanner) {
  // app.set('showStackError', true)
  app.set('etag', false)

  app.enable('jsonp callback')

  app.all('*', (req, res, next) => {
    req.storage = storage
    req.scanner = scanner
    next()
  })

  app.use(cors({origin: true, credentials: true}))
  app.use(compression())
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({extended: true}))

  app.use((req, res, next) => {
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

  app.use((req, res) => {
    res.jfail('The endpoint you are looking for does not exist!')
  })

  let server = (() => {
    if (!!config.get('chromanode.enableHTTPS') === false) {
      return http.createServer(app)
    }

    let opts = {}
    opts.key = fs.readFileSync('etc/key.pem')
    opts.cert = fs.readFileSync('etc/cert.pem')
    return https.createServer(opts, app)
  })()

  return PUtils.promisifyAll(server)
}
