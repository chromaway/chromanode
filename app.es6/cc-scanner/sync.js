import _ from 'lodash'
import makeConcurrent from 'make-concurrent'
import { autobind } from 'core-decorators'
import bitcore from 'bitcore'
import cclib from 'coloredcoinjs-lib'
import ElapsedTime from 'elapsed-time'

import config from '../lib/config'
import logger from '../lib/logger'
import SQL from './sql'

const cdefClss = cclib.definitions.Manager.getColorDefinitionClasses()

function callWithLock (target, name, descriptor) {
  let fn = descriptor.value
  descriptor.value = async function () {
    return this.withLock(() => { return fn.apply(this, arguments) })
  }
}

/**
 * @class Sync
 */
export default class Sync {
  /**
   * @constructor
   * @param {Storage} storage
   * @param {Messages} messages
   */
  constructor (storage, messages) {
    this.storage = storage
    this.messages = messages
  }

  /**
   * @param {string} txid
   * @return {Promise.<string>}
   */
  @autobind
  async getTx (txid) {
    let {rows} = await this.storage.executeQuery(SQL.select.rawtx, [`\\x${txid}`])
    if (rows.length === 0) {
      throw new Error(`Tx ${txid} not found!`)
    }

    return bitcore.Transaction(rows[0].tx.toString('hex'))
  }

  /**
   * @param {pg.Client} client
   * @param {string} txid
   * @param {string} [blockhash]
   * @param {number} [height]
   * @return {Promise<boolean>}
   */
  async _addTx (client, txid, blockhash, height) {
    let {rows} = await client.queryAsync(SQL.select.isTxScanned, [`\\x${txid}`])
    if (rows[0].exists === 't') {
      return false
    }

    let tx = await this.getTx(txid)
    let opts = {executeOpts: {client: client}}

    let query = SQL.insert.unconfirmed
    let params = [`\\x${txid}`]
    if (blockhash !== undefined) {
      query = SQL.insert.confirmed
      params.push(`\\x${blockhash}`, height)
    }

    await* _.flattenDeep([
      cdefClss.map((cdefCls) => {
        return this._cdata.getTxColorValues(tx, null, cdefCls, this.getTx, opts)
        // TODO: broadcast about color values
      }),
      client.queryAsync(query, params)
    ])

    return true
  }

  /**
   */
  @makeConcurrent({concurrency: 1})
  withLock (fn) { return fn() }

  /**
   * @param {string} txId
   * @return {Promise}
   */
  @callWithLock
  async addTx (txId) {
    try {
      let stopwatch = ElapsedTime.new().start()

      let added = await this.storage.executeTransaction((client) => {
        return this._addTx(client, txId)
      })

      if (added) {
        logger.verbose(`Add unconfirmed tx ${txId}, elapsed time: ${stopwatch.getValue()}`)
      }
    } catch (err) {
      logger.error(`Error on adding unconfirmed tx ${txId}: ${err.stack}`)
    }
  }

  /**
   * @param {string} txid
   * @return {Promise}
   */
  @callWithLock
  async removeTx (txId) {
    try {
      let stopwatch = ElapsedTime.new().start()

      let removed = await this.storage.executeTransaction(async (client) => {
        let {rows} = await client.queryAsync(SQL.select.isTxScanned, [`\\x${txId}`])
        if (rows[0].exists === 'f') {
          return false
        }

        let opts = {executeOpts: {client: client}}

        await* _.flattenDeep([
          cdefClss.map((cdefCls) => {
            return this._cdata.removeColorValues(txId, cdefCls, opts)
            // TODO: broadcast about removed (modify cclib)
          }),
          client.queryAsync(SQL.delete.row, [`\\x${txId}`])
        ])

        return true
      })

      if (removed) {
        logger.verbose(`Remove tx ${txId}, elapsed time: ${stopwatch.getValue()}`)
      }
    } catch (err) {
      logger.error(`Error on removing tx ${txId}: ${err.stack}`)
    }
  }

  /**
   * @return {Promise}
   */
  @callWithLock
  async updateBlocks () {
    while (true) {
      try {
        let stopwatch = ElapsedTime.new().start()

        // reorg check
        while (true) {
          stopwatch.reset().start()

          let {rows} = await this.storage.executeQuery(SQL.select.ccLatestBlock)
          if (rows.length === 0) {
            break
          }

          let hash = rows[0].blockhash.toString('hex')
          let result = await this.storage.executeQuery(SQL.select.isBlockExists, [`\\x${hash}`])
          if (result.rows[0].exists === 't') {
            break
          }

          await this.storage.executeQuery(SQL.update.makeUnconfirmed, [`\\x${hash}`])

          logger.warn(`Make reorg to ${rows[0].height - 1}, elapsed time: ${stopwatch.getValue()}`)
        }

        // add blocks
        while (true) {
          stopwatch.reset().start()

          let [cLatest, mLatest] = [
            (await this.storage.executeQuery(SQL.select.latestBlock)).rows[0],
            (await this.storage.executeQuery(SQL.select.ccLatestBlock)).rows[0]
          ]

          let hash = cLatest.hash.toString('hex')
          let height = cLatest.height

          if (mLatest !== undefined) {
            if (mLatest.blockhash.toString('hex') === hash) {
              break
            }

            if (mLatest.height >= height) {
              throw new Error('Need reorg')
            }
          }

          await this.storage.executeTransaction(async (client) => {
            let txIds = cLatest.txids.toString('hex')
            let toUpdate = await* _.range(txIds.length / 64).map(async (i) => {
              let txId = txIds.slice(i * 64, (i + 1) * 64)
              if (!(await this._addTx(client, txId, hash, height))) {
                return txId
              }
            })

            await client.queryAsync(SQL.update.makeConfirmed, [
              _.filter(toUpdate).map((txId) => `\\x${txId}`),
              `\\x${hash}`,
              height
            ])
          })

          logger.info(`Import block ${hash}:${height}, elapsed time: ${stopwatch.getValue()}`)
        }

        // update unconfirmed
        let [ccTxIds, txIds] = await* [
          this.storage.executeQuery(SQL.select.ccUnconfirmedTxIds),
          this.storage.executeQuery(SQL.select.unconfirmedTxIds)
        ]

        ccTxIds = ccTxIds.rows.map((row) => row.txid.toString('hex'))
        txIds = txIds.rows.map((row) => row.txid.toString('hex'))

        // remove
        for (let txId of _.difference(ccTxIds, txIds)) {
          this.removeTx(txId)
        }

        // add
        for (let txId of _.difference(txIds, ccTxIds)) {
          this.addTx(txId)
        }
      } catch (err) {
        logger.error(`Update error: ${err.stack}`)
      }
    }
  }

  /**
   * @return {Promise}
   */
  async run () {
    this._cdefstorage = new cclib.storage.definitions.PostgreSQL({url: config.get('postgresql.url')})
    this._cdmanager = new cclib.definitions.Manager(this._cdefstorage)

    this._cdstorage = new cclib.storage.data.PostgreSQL({url: config.get('postgresql.url')})
    this._cdata = new cclib.ColorData(this._cdstorage, this._cdmanager)

    await* [this._cdefstorage.ready, this._cdstorage.ready]

    // scan all new rows
    await this.updateBlocks()

    // subscribe for tx/block events
    await* [
      this.messages.listen('addtx', ::this.addTx),
      this.messages.listen('removetx', ::this.removeTx),
      this.messages.listen('addblock', ::this.updateBlocks),
      this.messages.listen('removeblock', ::this.updateBlocks)
    ]

    // confirm that all new data was scanned
    await this.updateBlocks()
  }
}
