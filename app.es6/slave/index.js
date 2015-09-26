import express from 'express'

import config from '../lib/config'
import logger from '../lib/logger'
import createServer from './http'
import SocketIO from './ws'
import Master from './master'
import Storage from '../lib/storage'
import Messages from '../lib/messages'

/**
 * @return {Promise}
 */
export default async function () {
  let storage = new Storage()
  let mNotifications = new Messages({storage: storage})
  let mSendTx = new Messages({storage: storage})
  let master = new Master(storage, mNotifications, mSendTx)

  await* [storage.ready, master.ready]

  let expressApp = express()
  let server = createServer(expressApp, storage, master)

  if (!!config.get('chromanode.enableNotifications') === true) {
    new SocketIO(master).attach(server)
  }

  await server.listen(config.get('chromanode.port'))

  logger.info(`Slave server listening port ${config.get('chromanode.port')}`)
}
