import _ from 'lodash'
import { EventEmitter } from 'events'
import { setImmediate } from 'timers'
import bitcore from 'bitcore'
import script2addresses from 'script2addresses'
import ElapsedTime from 'elapsed-time'
import makeConcurrent from 'make-concurrent'
import PUtils from 'promise-useful-utils'

import config from '../lib/config'
import logger from '../lib/logger'
import { ZERO_HASH } from '../lib/const'
import util from '../lib/util'
import SQL from '../lib/sql'

/**
 * @event Sync#latest
 * @param {{hash: string, height: number}} latest
 */

/**
 * @event Sync#tx
 * @param {string} txId
 */

/**
 * @class Sync
 * @extends events.EventEmitter
 */
export default class Sync extends EventEmitter {
  /**
   * @constructor
   * @param {Storage} storage
   * @param {Network} network
   * @param {Service} service
   */
  constructor (storage, network, service) {
    super()

    this._storage = storage
    this._network = network
    this._service = service

    let networkName = config.get('chromanode.network')
    this._bitcoinNetwork = bitcore.Networks.get(networkName)

    this._latest = null
    this._blockchainLatest = null

    this._lock = new util.SmartLock()

    this._orphanedTx = {
      deps: {}, // txId -> txId[]
      orphans: {}  // txId -> txId[]
    }
  }

  /**
   * @param {bitcore.Transaction.Output} output
   * @return {string[]}
   */
  _getAddresses (output) {
    let result = script2addresses(output.script, this._bitcoinNetwork, false)
    return result.addresses || []
  }

  /**
   * @param {Objects} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise<{hash: string, height: number}>}
   */
  _getLatest (opts) {
    let execute = ::this._storage.executeTransaction
    if (_.has(opts, 'client')) {
      execute = (fn) => fn(opts.client)
    }

    return execute(async (client) => {
      let result = await client.queryAsync(SQL.select.blocks.latest)
      if (result.rowCount === 0) {
        return {hash: ZERO_HASH, height: -1}
      }

      let row = result.rows[0]
      return {hash: row.hash.toString('hex'), height: row.height}
    })
  }

  _importOrphaned (txId) {
    // are we have orphaned tx that depends from this txId?
    let orphans = this._orphanedTx.orphans[txId]
    if (orphans === undefined) {
      return
    }

    delete this._orphanedTx.orphans[txId]

    // check every orphaned tx
    for (let orphaned of orphans) {
      // all deps resolved?
      let deps = _.without(this._orphanedTx.deps[orphaned], txId)
      if (deps.length > 0) {
        this._orphanedTx.deps[orphaned] = deps
        continue
      }

      // run import if all resolved transactions
      delete this._orphanedTx.deps[orphaned]
      setImmediate(::this._runTxImport, orphaned)
      logger.warn(`Run import for orphaned tx: ${orphaned}`)
    }
  }

  /**
   * @param {bitcore.Transaction} tx
   * @return {Promise}
   */
  _importUnconfirmedTx (tx) {
    let txId = tx.id
    let prevTxIds = _.uniq(
      tx.inputs.map((input) => input.prevTxId.toString('hex')))

    return this._lock.withLock(prevTxIds.concat(txId), () => {
      let stopwatch = ElapsedTime.new().start()
      return this._storage.executeTransaction(async (client) => {
        // transaction already in database?
        let result = await client.queryAsync(
          SQL.select.transactions.exists, [`\\x${txId}`])
        if (result.rows[0].exists === true) {
          return true
        }

        // all inputs exists?
        result = await client.queryAsync(
          SQL.select.transactions.existsMany, [prevTxIds.map((i) => `\\x${i}`)])
        let deps = _.difference(
          prevTxIds, result.rows.map((row) => row.txid.toString('hex')))

        // some input not exists yet, mark as orphaned and delay
        if (deps.length > 0) {
          this._orphanedTx.deps[txId] = deps
          for (let dep of deps) {
            this._orphanedTx.orphans[dep] = _.union(this._orphanedTx.orphans[dep], [txId])
          }
          logger.warn(`Orphan tx: ${txId} (deps: ${deps.join(', ')})`)
          return false
        }

        // import transaction
        let pImportTx = client.queryAsync(SQL.insert.transactions.unconfirmed, [
          `\\x${txId}`,
          `\\x${tx.toString()}`
        ])

        // import intputs
        let pImportInputs = tx.inputs.map(async (input, index) => {
          let {rows} = await client.queryAsync(SQL.update.history.addUnconfirmedInput, [
            `\\x${txId}`,
            `\\x${input.prevTxId.toString('hex')}`,
            input.outputIndex
          ])

          return rows.map((row) => {
            let address = row.address.toString()
            return this._service.broadcastAddress(address, txId, null, null, {client: client})
          })
        })

        // import outputs
        let pImportOutputs = tx.outputs.map((output, index) => {
          let addresses = this._getAddresses(output)
          return addresses.map((address) => {
            let pImport = client.queryAsync(SQL.insert.history.unconfirmedOutput, [
              address,
              `\\x${txId}`,
              index,
              output.satoshis,
              `\\x${output.script.toHex()}`
            ])
            let pBroadcast = this._service.broadcastAddress(address, txId, null, null, {client: client})

            return [pImport, pBroadcast]
          })
        })

        // wait all imports and broadcasts
        await* _.flattenDeep([
          pImportTx,
          pImportInputs,
          pImportOutputs,
          this._service.broadcastTx(txId, null, null, {client: client}),
          this._service.addTx(txId, {client: client})
        ])

        logger.verbose(`Import unconfirmed tx ${txId}, elapsed time: ${stopwatch.getValue()}`)
        return true
      })
      .catch((err) => {
        logger.error(`Import unconfirmed tx: ${err.stack}`)
        return false
      })
    })
  }

  /**
   * @param {string} txId
   */
  async _runTxImport (txId) {
    try {
      // get tx from bitcoind
      let tx = await this._network.getTx(txId)

      // ... and run import
      let imported = await this._importUnconfirmedTx(tx)
      if (imported) {
        setImmediate(::this._importOrphaned, txId)
        this.emit('tx', txId)
      }
    } catch (err) {
      logger.error(`Tx import: ${err.stack}`)
    }
  }

  /**
   * @param {bitcore.Block} block
   * @param {number} height
   * @param {pg.Client} client
   * @return {Promise}
   */
  _importBlock (block, height, client) {
    let txIds = _.pluck(block.transactions, 'id')
    let existingTx = {}

    let allTxIds = _.uniq(_.flatten(block.transactions.map((tx) => {
      return tx.inputs.map((i) => i.prevTxId.toString('hex'))
    }).concat(txIds)))

    return this._lock.withLock(allTxIds, async () => {
      // import header
      let pImportHeader = client.queryAsync(SQL.insert.blocks.row, [
        height,
        `\\x${block.hash}`,
        `\\x${block.header.toString()}`,
        `\\x${txIds.join('')}`
      ])

      // import transactions & outputs
      let pImportTxAndOutputs = await* block.transactions.map(async (tx, txIndex) => {
        let txId = txIds[txIndex]
        let pImportTx
        let pBroadcastAddreses

        // tx already in storage ?
        let result = await client.queryAsync(SQL.select.transactions.exists, [`\\x${txId}`])

        // if already exist, mark output as confirmed and broadcast addresses
        if (result.rows[0].exists === true) {
          existingTx[txId] = true

          pBroadcastAddreses = PUtils.try(async () => {
            let [, {rows}] = await* [
              client.queryAsync(SQL.update.transactions.makeConfirmed, [height, `\\x${txId}`]),
              client.queryAsync(SQL.update.history.makeOutputConfirmed, [height, `\\x${txId}`])
            ]

            return rows.map((row) => {
              let address = row.address.toString()
              return this._service.broadcastAddress(address, txId, block.hash, height, {client: client})
            })
          })
        } else {
          // import transaction
          pImportTx = client.queryAsync(SQL.insert.transactions.confirmed, [
            `\\x${txId}`,
            height,
            `\\x${tx.toString()}`
          ])

          // import outputs only if transaction not imported yet
          pBroadcastAddreses = await* tx.outputs.map((output, index) => {
            let addresses = this._getAddresses(output)
            return Promise.all(addresses.map(async (address) => {
              // wait output import, it's important!
              await client.queryAsync(SQL.insert.history.confirmedOutput, [
                address,
                `\\x${txId}`,
                index,
                output.satoshis,
                `\\x${output.script.toHex()}`,
                height
              ])

              return this._service.broadcastAddress(address, txId, block.hash, height, {client: client})
            }))
          })
        }

        return [
          pImportTx,
          this._service.broadcastTx(txId, block.hash, height, {client: client}),
          this._service.addTx(txId, {client: client}),
          pBroadcastAddreses
        ]
      })

      // import inputs
      let pImportInputs = block.transactions.map((tx, txIndex) => {
        let txId = txIds[txIndex]
        return tx.inputs.map(async (input, index) => {
          // skip coinbase
          let prevTxId = input.prevTxId.toString('hex')
          if (index === 0 &&
              input.outputIndex === 0xFFFFFFFF &&
              prevTxId === ZERO_HASH) {
            return
          }

          let result
          if (existingTx[txId] === true) {
            result = await client.queryAsync(SQL.update.history.makeInputConfirmed, [
              height,
              `\\x${prevTxId}`,
              input.outputIndex
            ])
          } else {
            result = await client.queryAsync(SQL.update.history.addConfirmedInput, [
              `\\x${txId}`,
              height,
              `\\x${prevTxId}`,
              input.outputIndex
            ])
          }

          await* result.rows.map((row) => {
            let address = row.address.toString()
            return this._service.broadcastAddress(address, txId, block.hash, height, {client: client})
          })
        })
      })

      await* _.flattenDeep([
        pImportHeader,
        pImportTxAndOutputs,
        pImportInputs,
        this._service.broadcastBlock(block.hash, height, {client: client}),
        this._service.addBlock(block.hash, {client: client})
      ])
    })
  }

  /**
   * @param {string[]} txIds
   * @return {Promise<string[]>}
   */
  async _updateBitcoindMempool (txIds) {
    let {rows} = await this._storage.executeQuery(
      SQL.select.transactions.byTxIds, [txIds.map((txId) => `\\x${txId}`)])

    let txs = util.toposort(rows.map((row) => bitcore.Transaction(row.tx)))
    let notAddedTxIds = []

    for (let tx of txs) {
      try {
        await this._network.sendTx(tx.toString())
      } catch (err) {
        notAddedTxIds.push(tx.id)
      }
    }

    return notAddedTxIds
  }

  /**
   * @param {string[]} rTxIds
   * @return {Promise}
   */
  async _removeUnconfirmedTxIds (rTxIds) {
    for (let start = 0; start < rTxIds.length; start += 250) {
      let txIds = rTxIds.slice(start, start + 250)
      let params = [txIds.map((txId) => `\\x${txId}`)]
      await this._storage.executeTransaction(async (client) => {
        await* [
          client.queryAsync(SQL.delete.transactions.unconfirmedByTxIds, params),
          client.queryAsync(SQL.delete.history.unconfirmedByTxIds, params)
        ]
        await* _.flattenDeep([
          client.queryAsync(SQL.update.history.deleteUnconfirmedInputsByTxIds, params),
          txIds.map((txId) => this._service.removeTx(txId, {client: client}))
        ])
      })
    }
  }

  /**
   * @param {boolean} [updateBitcoindMempool=false]
   * @return {Promise}
   */
  @makeConcurrent({concurrency: 1})
  async _runBlockImport (updateBitcoindMempool = false) {
    let stopwatch = new ElapsedTime()
    let block

    while (true) {
      try {
        this._blockchainLatest = await this._network.getLatest()

        while (true) {
          // are blockchain have new blocks?
          if (this._latest.height === this._blockchainLatest.height) {
            this._blockchainLatest = await this._network.getLatest()
          }

          // synced with bitcoind, out
          if (this._latest.hash === this._blockchainLatest.hash) {
            break
          }

          // find latest block in storage that located in blockchain
          let latest = this._latest
          while (true) {
            stopwatch.reset().start()
            block = await this._network.getBlock(latest.height + 1)
            logger.verbose(`Downloading block ${latest.height + 1}, elapsed time: ${stopwatch.getValue()}`)

            // found latest that we need
            if (latest.hash === util.encode(block.header.prevHash)) {
              break
            }

            // update latest
            let {rows} = await this._storage.executeQuery(
              SQL.select.blocks.byHeight, [latest.height - 1])
            latest = {hash: rows[0].hash.toString('hex'), height: rows[0].height}
          }

          // was reorg found?
          if (latest.hash !== this._latest.hash) {
            await this._lock.reorgLock(async () => {
              stopwatch.reset().start()
              this._latest = await this._storage.executeTransaction(async (client) => {
                let args = [latest.height - 1]
                let {rows} = await client.queryAsync(SQL.select.blocks.fromHeight, args)

                await* _.flattenDeep([
                  client.queryAsync(SQL.delete.blocks.fromHeight, args),
                  client.queryAsync(SQL.update.transactions.makeUnconfirmed, args),
                  PUtils.try(async () => {
                    await client.queryAsync(SQL.update.history.makeOutputsUnconfirmed, args)
                    await client.queryAsync(SQL.update.history.makeInputsUnconfirmed, args)
                  }),
                  rows.map((row) => {
                    return this._service.removeBlock(row.hash.toString('hex'), {client: client})
                  })
                ])

                return await this._getLatest({client: client})
              })
              logger.warn(`Reorg finished (back to ${latest.height - 1}), elapsed time: ${stopwatch.getValue()}`)
            })
          }

          // import block
          stopwatch.reset().start()
          this._latest = await this._storage.executeTransaction(async (client) => {
            await this._importBlock(block, latest.height + 1, client)
            return await this._getLatest({client: client})
          })
          logger.verbose(`Import block #${latest.height + 1}, elapsed time: ${stopwatch.getValue()} (hash: ${this._latest.hash})`)

          logger.info(`New latest! ${this._latest.hash}:${this._latest.height}`)
          this.emit('latest', this._latest)

          // notify that tx was imported
          for (let txId of _.pluck(block.transactions, 'id')) {
            setImmediate(::this._importOrphaned, txId)
            this.emit('tx', txId)
          }
        }

        break
      } catch (err) {
        logger.error(`Block import error: ${err.stack}`)

        while (true) {
          try {
            this._latest = await this._getLatest()
            break
          } catch (err) {
            logger.error(`Block import (get latest): ${err.stack}`)
            await PUtils.delay(1000)
          }
        }
      }
    }

    while (true) {
      // sync with bitcoind mempool
      try {
        stopwatch.reset().start()

        let [nTxIds, sTxIds] = await* [
          this._network.getMempoolTxs(),
          this._storage.executeQuery(SQL.select.transactions.unconfirmed)
        ]

        sTxIds = sTxIds.rows.map((row) => row.txid.toString('hex'))

        // remove tx that not in mempool but in our storage
        let rTxIds = _.difference(sTxIds, nTxIds)
        if (rTxIds.length > 0 && updateBitcoindMempool) {
          rTxIds = await this._updateBitcoindMempool(rTxIds)
        }
        if (rTxIds.length > 0) {
          await this._removeUnconfirmedTxIds(rTxIds)
        }

        // add skipped tx in our storage
        for (let txId of _.difference(nTxIds, sTxIds)) {
          setImmediate(::this._runTxImport, txId)
        }

        logger.info(`Update mempool finished, elapsed time: ${stopwatch.getValue()}`)

        break
      } catch (err) {
        logger.error(`On updating mempool: ${err.stack}`)
        await PUtils.delay(5000)
      }
    }
  }

  /**
   */
  async run () {
    // update latests
    this._latest = await this._getLatest()
    this._blockchainLatest = await this._network.getLatest()

    // show info message
    logger.info(`Got ${this._latest.height + 1} blocks in current db, out of ${this._blockchainLatest.height + 1} block at bitcoind`)

    // make sure that we have latest block
    await this._runBlockImport(true)

    // set handlers
    this._network.on('tx', ::this._runTxImport)
    this._network.on('block', ::this._runBlockImport)

    // and run sync again
    await this._runBlockImport(true)
  }
}
