import express from 'express'

import config from '../lib/config'
import logger from '../lib/logger'
import createServer from './http'
import SocketIO from './ws'
import Scanner from './scanner'
import Storage from '../lib/storage'
import Messages from '../lib/messages'

/**
 * @return {Promise}
 */
export default async function () {
  let storage = new Storage()
  let mNotifications = new Messages({storage: storage})
  let mSendTx = new Messages({storage: storage})
  let scanner = new Scanner(storage, mNotifications, mSendTx)

  await* [storage.ready, scanner.ready]

  let expressApp = express()
  let server = createServer(expressApp, storage, scanner)

  if (!!config.get('chromanode.enableNotifications') === true) {
    new SocketIO(scanner).attach(server)
  }

  await server.listen(config.get('chromanode.port'))

  logger.info(`Service server listening port ${config.get('chromanode.port')}`)
}
