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
  let messages = new Messages({storage: storage})
  let master = new Master(storage, messages)

  await* [storage.ready, messages.ready, master.ready]

  let expressApp = express()
  let server = createServer(expressApp, storage, master)

  // TODO: allow disable socket.io (need split notification and send transactions via messages)
  let socket = new SocketIO(master)
  socket.attach(server)

  await server.listen(config.get('chromanode.port'))

  logger.info(`Slave server listening port ${config.get('chromanode.port')}`)
}
