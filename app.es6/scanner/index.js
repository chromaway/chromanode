import _ from 'lodash'
import { setImmediate } from 'timers'
import makeConcurrent from 'make-concurrent'
import PUtils from 'promise-useful-utils'
import bitcore from 'bitcore-lib'

import config from '../lib/config'
import logger from '../lib/logger'
import Storage from '../lib/storage'
import Messages from '../lib/messages'
import Network from './network'
import Service from './service'
import util from '../lib/util'
import { VERSION } from '../lib/const'
import Sync from './sync'
import SQL from '../lib/sql'

let sha256sha256 = bitcore.crypto.Hash.sha256sha256

/**
 * @return {Promise}
 */
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
  let sendTxDeferreds = {}

  let storage = new Storage()
  let messages = new Messages({storage: storage})
  let service = new Service(messages)
  let network = new Network()
  await* _.pluck([storage, messages, service, network], 'ready')

  // create function for broadcasting status
  let broadcastStatus = _.debounce(() => {
    service.broadcastStatus(status)
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

  // create sync process
  let sync = new Sync(storage, network, service)
  sync.on('latest', (latest) => {
    status.latest = latest

    let value = latest.height / status.bitcoind.latest.height
    let fixedValue = value.toFixed(4)
    if (status.progress !== fixedValue) {
      logger.warn(`Sync progress: ${value.toFixed(6)} (${latest.height} of ${status.bitcoind.latest.height})`)
      status.progress = fixedValue
      broadcastStatus()
    }
  })

  await sync.run()
  // drop old listeners (for latest event that out info to console)
  sync.removeAllListeners()

  // broadcast status on latest
  sync.on('latest', (latest) => {
    status.latest = latest
    broadcastStatus()
  })

  // resolve deferred object for sending tx
  sync.on('tx', (txId) => {
    let deferred = sendTxDeferreds[txId]
    if (deferred !== undefined) {
      deferred.resolve()
      clearTimeout(deferred.timeoutId)
      delete sendTxDeferreds[txId]
    }
  })

  // setup listener for event sendTx from services
  let onSendTx = async (id) => {
    let txId
    let _err = null

    try {
      let {rows} = await storage.executeQuery(SQL.delete.newTx.byId, [id])
      txId = util.encode(sha256sha256(rows[0].tx))
      let txHex = rows[0].tx.toString('hex')
      logger.verbose(`sendTx: ${txId} (${txHex})`)

      let addedToStorage = new Promise((resolve, reject) => {
        sendTxDeferreds[txId] = {
          resolve: resolve,
          timeoutId: setTimeout(reject, 1800000) // 30 min.
        }
      })

      await network.sendTx(txHex)

      await addedToStorage

      logger.verbose(`sendTx: success (${txId})`)
    } catch (err) {
      logger.error(`sendTx: (${txId}) ${err.stack}`)

      if (txId && sendTxDeferreds[txId]) {
        clearTimeout(sendTxDeferreds[txId].timeoutId)
        delete sendTxDeferreds[txId]
      }

      _err = {code: null, message: err.message}
    }

    await service.sendTxResponse(id, _err)
  }
  service.on('sendTx', onSendTx)

  // get all waiting ids for sending transacitons
  let {rows} = await storage.executeQuery(SQL.select.newTxs.all)
  for (let row of rows) {
    onSendTx(row.id)
  }
}
