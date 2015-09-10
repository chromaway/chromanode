import express from 'express'

import config from '../lib/config'
import logger from '../lib/logger'
import http from './http'
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
  let socket = new SocketIO(master)

  await* [storage.ready, messages.ready, master.ready]

  let expressApp = express()
  http.setup(expressApp, storage, master)

  let server = http.createServer(expressApp)
  socket.attach(server)

  await server.listen(config.get('chromanode.port'))

  logger.info(`Slave server listening port ${config.get('chromanode.port')}`)
}
