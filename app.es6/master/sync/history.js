import _ from 'lodash'
import makeConcurrent from 'make-concurrent'
import ElapsedTime from 'elapsed-time'
import PUtils from 'promise-useful-utils'

import logger from '../../lib/logger'
import { ZERO_HASH } from '../../lib/const'
import Sync from './sync'
import SQL from '../sql'

/**
 * @class HistorySync
 * @extends Sync
 */
export default class HistorySync extends Sync {
  /**
   * @constructor
   */
  constructor (...args) {
    super(...args)

    this._progress = null
  }

  /**
   * @param {bitcore.Block} block
   * @param {number} height
   * @param {pg.Client} client
   * @return {Promise}
   */
  async _importBlock (block, height, client) {
    let txids = _.pluck(block.transactions, 'hash')

    // import header
    await client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ])

    // import transactions & outputs
    await* block.transactions.map(async (tx, txIndex) => {
      // import transaction
      await client.queryAsync(SQL.insert.transactions.confirmed, [
        '\\x' + txids[txIndex],
        height,
        '\\x' + tx.toString()
      ])

      // import transaction outputs
      await* tx.outputs.map((output, outputIndex) => {
        let addresses = this._safeGetAddresses(output, txids[txIndex], outputIndex)
        return Promise.all(addresses.map((address) => {
          return client.queryAsync(SQL.insert.history.confirmedOutput, [
            address,
            '\\x' + txids[txIndex],
            outputIndex,
            output.satoshis,
            '\\x' + output.script.toHex(),
            height
          ])
        }))
      })
    })

    // import inputs
    await* block.transactions.map((tx, txIndex) => {
      return Promise.all(tx.inputs.map((input, index) => {
        // skip coinbase
        let prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === ZERO_HASH) {
          return
        }

        return client.queryAsync(SQL.update.history.addConfirmedInput, [
          '\\x' + txids[txIndex],
          height,
          '\\x' + prevTxId,
          input.outputIndex
        ])
      }))
    })
  }

  /**
   * @return {Promise}
   */
  async run () {
    // update latests
    this._latest = await this._getLatest()
    this._blockchainLatest = await this._network.getLatest()

    // show info message
    logger.info(`Got ${this._latest.height + 1} blocks in current db, out of ${this._blockchainLatest.height + 1} block at bitcoind`)

    // return if difference not big
    if (this._blockchainLatest.height - this._latest.height < 6 * 24 * 3) {
      return
    }

    // remove unconfirmed data
    await this._storage.executeTransaction(async (client) => {
      let queries = [
        SQL.delete.transactions.unconfirmed,
        SQL.delete.history.unconfirmed,
        SQL.update.history.deleteUnconfirmedInputs
      ]

      let stopwatch = ElapsedTime.new().start()
      for (let query of queries) {
        await client.queryAsync(query)
      }

      logger.info(`Delete unconfirmed data, elapsed time: ${stopwatch.getValue()}`)
    })

    // create block event listener
    let onBlockchainNewBlock = makeConcurrent(async () => {
      this._blockchainLatest = await this._network.getLatest()
    }, {concurrency: 1})
    this._network.on('block', onBlockchainNewBlock)

    // sync with storage chain
    let needUpdate = true
    do {
      try {
        needUpdate = await this._updateChain()

        // emit latest
        this.emit('latest', this._latest)
      } catch (err) {
        logger.error(`HistorySync: ${err.stack}`)

        // new attempt after 15s
        await PUtils.delay(15000)
      }
    } while (needUpdate)

    // remove listener
    this._network.removeListener('block', onBlockchainNewBlock)
  }
}
