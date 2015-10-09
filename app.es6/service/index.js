import _ from 'lodash'
import express from 'express'
import cclib from 'coloredcoinjs-lib'

import config from '../lib/config'
import logger from '../lib/logger'
import createServer from './http'
import SocketIO from './ws'
import Scanner from './scanner'
import Storage from '../lib/storage'
import Messages from '../lib/messages'
import cc from './http/controllers/cc'

/**
 * @return {Promise}
 */
export default async function () {
  let storage = new Storage()
  let mNotifications = new Messages({storage: storage})
  let mSendTx = new Messages({storage: storage})
  let scanner = new Scanner(storage, mNotifications, mSendTx)

  let cdefStorage = new cclib.storage.definitions.PostgreSQL({url: config.get('postgresql.url')})
  let cdataStorage = new cclib.storage.data.PostgreSQL({url: config.get('postgresql.url')})
  let cdefManager = new cclib.definitions.Manager(cdefStorage, cdefStorage)
  let cdata = new cclib.ColorData(cdataStorage, cdefManager)
  cc.init(cdefManager, cdata)

  await* _.pluck([storage, scanner, cdefManager, cdata], 'ready')

  let expressApp = express()
  let server = createServer(expressApp, storage, scanner)

  if (!!config.get('chromanode.enableNotifications') === true) {
    new SocketIO(scanner).attach(server)
  }

  await server.listen(config.get('chromanode.port'))

  logger.info(`Service server listening port ${config.get('chromanode.port')}`)
}
