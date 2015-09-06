import _ from 'lodash'
import { setImmediate } from 'timers'
import makeConcurrent from 'make-concurrent'
import PUtils from 'promise-useful-utils'

import config from '../lib/config'
import logger from '../lib/logger'
import Storage from '../lib/storage'
import Messages from '../lib/messages'
import Network from './network'
import Slaves from './slaves'
import { VERSION } from '../lib/const'
import HistorySync from './sync/history'
import PeerSync from './sync/peer'
import SQL from './sql'

export default async function () {
  let status = {
    version: VERSION,
    network: config.get('chromanode.network'),
    progress: null,
    latest: {
      hash: null,
      height: null
    },
    bitcoind: {
      version: null,
      protocolversion: null,
      connections: 0,
      errors: null,
      latest: {
        hash: null,
        height: null
      }
    }
  }

  let storage = new Storage()
  let messages = new Messages({storage: storage})
  let slaves = new Slaves(messages)
  let network = new Network()
  await* _.pluck([storage, messages, slaves, network], 'ready')

  // create function for broadcasting status
  let broadcastStatus = _.debounce(() => {
    slaves.broadcastStatus(status)
  }, 500)

  // update bitcoind info in status every 5s
  setImmediate(async () => {
    while (true) {
      try {
        let info = await network.getBitcoindInfo()
        let old = status.bitcoind
        let shouldBroadcast = old.version !== info.version ||
                              old.protocolversion !== info.protocolversion ||
                              old.connections !== info.connections ||
                              old.errors !== info.errors

        if (shouldBroadcast) {
          status.bitcoind.version = info.version
          status.bitcoind.protocolversion = info.protocolversion
          status.connections = info.connections
          status.errors = info.errors
          broadcastStatus()
        }

      } catch (err) {
        logger.error(`Update bitcoind info: ${err.stack}`)
      }

      await PUtils.delay(5000)
    }
  })

  // update bitcoind latest in status on new block
  let onNewBlock = makeConcurrent(async () => {
    let latest = await network.getLatest()
    if (status.bitcoind.latest.hash !== latest.hash) {
      status.bitcoind.latest = latest
      broadcastStatus()
    }
  }, {concurrency: 1})
  network.on('block', onNewBlock)
  await onNewBlock()

  // setup listener for event sendTx from slaves
  slaves.on('sendTx', (id) => {
    // TODO: wait event from chromanode that tx was added to storage!
    storage.execute(async (client) => {
      let result = await client.queryAsync(SQL.select.newTx.byId, [id])
      logger.info(`sendTx ${result.rows[0].hex}`)
      await client.queryAsync(SQL.delete.newTx.byId, [id])
      await network.sendTx(result.rows[0].hex)
      logger.info('sendTx', 'success')
      return null
    })
    .catch((err) => {
      logger.error('sendTx', err)
      if (err instanceof Error) {
        return {code: null, message: err.message}
      }

      return err
    })
    .then((ret) => {
      slaves.sendTxResponse(id, ret)
    })
  })

  // sync to latest block
  let sync = new HistorySync(storage, messages, network, slaves)
  try {
    logger.info('Run history sync...')

    sync.on('latest', (latest) => {
      status.latest = latest

      let value = latest.height / status.bitcoind.latest.height
      let fixedValue = value.toFixed(4)
      if (status.progress !== fixedValue) {
        logger.info(`Sync progress: ${value.toFixed(6)} (${latest.height} of ${status.bitcoind.latest.height})`)
        status.progress = fixedValue
        broadcastStatus()
      }
    })

    await sync.run()
  } finally {
    sync.removeAllListeners()
    logger.info('History sync finished!')
  }

  // dynamically sync with bitcoin p2p network
  sync = new PeerSync(storage, messages, network, slaves)
  logger.info('Run peer sync ...')
  sync.on('latest', (latest) => {
    status.latest = latest
    broadcastStatus()
  })

  await sync.run()
}
