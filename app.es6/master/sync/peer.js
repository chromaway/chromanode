import _ from 'lodash'
import { setImmediate } from 'timers'
import ElapsedTime from 'elapsed-time'
import PUtils from 'promise-useful-utils'

import logger from '../../lib/logger'
import { ZERO_HASH } from '../../lib/const'
import Sync from './sync'
import SQL from '../sql'
import { ConcurrentImport } from '../../lib/util'

/**
 * @class PeerSync
 * @extends Sync
 */
export default class PeerSync extends Sync {
  /**
   * @constructor
   */
  constructor (...args) {
    super(...args)

    this._orphanedTx = {
      prev: {}, // txid -> txid[]
      next: {}  // txid -> txid[]
    }

    let ci = new ConcurrentImport()
    this._importUnconfirmedTx = ci.apply(this._importUnconfirmedTx, this, 'tx')
    this._runBlockImport = ci.apply(this._runBlockImport, this, 'block')

    this.on('tx', ::this._importDependsFrom)
  }

  /**
   * @param {bitcore.Block} block
   * @param {number} height
   * @param {pg.Client} client
   * @return {Promise}
   */
  async _importBlock (block, height, client) {
    let txids = _.pluck(block.transactions, 'hash')
    let existingTx = {}

    // accamulate not depends queries, should speedup process
    let promises = []

    // import header
    promises.push(client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ]))

    // broadcast about block
    promises.push(
      this._slaves.broadcastBlock(block.hash, height, {client: client}))

    // import transactions & outputs
    await* block.transactions.map(async (tx, txIndex) => {
      let txid = txids[txIndex]

      // tx already in storage ?
      let result = await client.queryAsync(
        SQL.select.transactions.exists, ['\\x' + txid])

      if (result.rows[0].count === '0') {
        // import transaction
        await client.queryAsync(SQL.insert.transactions.confirmed, [
          '\\x' + txid,
          height,
          '\\x' + tx.toString()
        ])

        // import outputs only if transaction not imported yet
        await* tx.outputs.map((output, index) => {
          let addresses = this._safeGetAddresses(output, txid, index)
          return Promise.all(addresses.map((address) => {
            promises.push(
              this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client}))

            return client.queryAsync(SQL.insert.history.confirmedOutput, [
              address,
              '\\x' + txid,
              index,
              output.satoshis,
              '\\x' + output.script.toHex(),
              height
            ])
          }))
        })
      } else {
        existingTx[txid] = true

        await client.queryAsync(
          SQL.update.transactions.makeConfirmed, [height, '\\x' + txid])

        let {rows} = await client.queryAsync(
          SQL.update.history.makeOutputConfirmed, [height, '\\x' + txid])

        for (let row of rows) {
          let address = row.address.toString('hex')
          promises.push(
            this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client}))
        }
      }

      promises.push(
        this._slaves.broadcastTx(txid, block.hash, height, {client: client}))
    })

    // import inputs
    await* block.transactions.map((tx, txIndex) => {
      let txid = txids[txIndex]
      return Promise.all(tx.inputs.map(async (input, index) => {
        // skip coinbase
        let prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === ZERO_HASH) {
          return
        }

        let result
        if (existingTx[txid] === true) {
          result = await client.queryAsync(SQL.update.history.makeInputConfirmed, [
            height,
            '\\x' + prevTxId,
            input.outputIndex
          ])
        } else {
          result = await client.queryAsync(SQL.update.history.addConfirmedInput, [
            '\\x' + txid,
            height,
            '\\x' + prevTxId,
            input.outputIndex
          ])
        }

        for (let row of result.rows) {
          let address = row.address.toString('hex')
          promises.push(
            this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client}))
        }
      }))
    })

    await* promises
  }

  /**
   * @param {bitcore.Transaction} tx
   * @return {Promise<boolean>}
   */
  _importUnconfirmedTx (tx) {
    let txid = tx.id

    let stopwatch = ElapsedTime.new().start()
    return this._storage.executeTransaction(async (client) => {
      // transaction already in database?
      let result = await client.queryAsync(
        SQL.select.transactions.exists, ['\\x' + txid])
      if (result.rows[0].count !== '0') {
        return false
      }

      // all inputs exists?
      let txids = _.invoke(_.pluck(tx.inputs, 'prevTxId'), 'toString', 'hex')
      result = await client.queryAsync(
        SQL.select.transactions.existsMany, [txids.map((i) => { return '\\x' + i })])
      let deps = _.difference(txid,
        _.invoke(_.pluck(result.rows, 'txid'), 'toString', 'hex'))

      // some input not exists yet, mark as orphaned and delay
      if (deps.length > 0) {
        this._orphanedTx.prev[txid] = deps
        for (let dep of deps) {
          this._orphanedTx.next[dep] = _.union(this._orphanedTx.next[dep], [txid])
        }
        logger.warn(`Orphan tx: ${txid} (deps: ${deps.join(', ')})`)
        return false
      }

      // accamulate not depends queries, should speedup process
      let promises = []

      // import transaction
      promises.push(client.queryAsync(SQL.insert.transactions.unconfirmed, [
        '\\x' + txid,
        '\\x' + tx.toString()
      ]))

      // import outputs
      await* tx.outputs.map((output, index) => {
        let addresses = this._safeGetAddresses(output, txid, index)
        return Promise.all(addresses.map((address) => {
          promises.push(
            this._slaves.broadcastAddress(address, txid, null, null, {client: client}))

          return client.queryAsync(SQL.insert.history.unconfirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex()
          ])
        }))
      })

      // import intputs
      await* tx.inputs.map(async (input, index) => {
        let {rows} = await client.queryAsync(SQL.update.history.addUnconfirmedInput, [
          '\\x' + txid,
          '\\x' + input.prevTxId.toString('hex'),
          input.outputIndex
        ])

        for (let row of rows) {
          let address = row.address.toString('hex')
          promises.push(
            this._slaves.broadcastAddress(address, txid, null, null, {client: client}))
        }
      })

      promises.push(
        this._slaves.broadcastTx(txid, null, null, {client: client}))

      await* promises

      return true
    })
    .then((value) => {
      this.emit('tx', txid)
      logger.verbose(`Import unconfirmed tx ${txid}, elapsed time: ${stopwatch.getValue()}`)
      return value
    })
    .catch((err) => {
      logger.error(`Import unconfirmed tx: ${err.stack}`)
    })
  }

  /**
   * @param {string} txid
   */
  _importDependsFrom (txid) {
    // check depends tx that mark as orphaned now
    let orphans = this._orphanedTx.next[txid]
    if (orphans === undefined) {
      return
    }

    delete this._orphanedTx.next[txid]

    // check every orphaned tx
    for (let orphaned of orphans) {
      // all deps resolved?
      let deps = _.without(this._orphanedTx.prev[orphaned], txid)
      if (deps.length > 0) {
        this._orphanedTx.prev[orphaned] = deps
        continue
      }

      // run import if all ok
      delete this._orphanedTx.prev[orphaned]
      setImmediate(::this._runTxImport, orphaned)
      logger.warn(`Run import for orphaned tx: ${orphaned}`)
    }
  }

  /**
   * @return {Promise}
   */
  async _runBlockImport () {
    // while not reached latest block
    do {
      try {
        this._blockchainLatest = await this._network.getLatest()

        // out if already latest
        let updated = await this._updateChain()
        if (updated === false) {
          return
        }

        logger.info(`New latest! ${this._latest.hash}:${this._latest.height}`)

        this.emit('latest', this._latest)

        // notify that tx was imported
        let result = await this._storage.executeQuery(
          SQL.select.blocks.txids, [this._latest.height])
        let txids = result.rows[0].txids.toString('hex')
        for (let i = 0, length = txids.length / 32; i < length; i += 1) {
          this.emit('tx', txids.slice(i * 32, (i + 1) * 32))
        }
      } catch (err) {
        logger.error(`Block import: ${err.stack}`)

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
    } while (this._latest.hash !== this._blockchainLatest.hash)

    try {
      // sync with bitcoind mempool
      let [nTxIds, sTxIds] = await Promise.all([
        this._network.getMempoolTxs(),
        this._storage.executeQuery(SQL.select.transactions.unconfirmed)
      ])

      sTxIds = sTxIds.rows.map((row) => { return row.txid.toString('hex') })

      // remove tx that not in mempool but in our storage
      let toRemove = _.difference(sTxIds, nTxIds)
      if (toRemove.length > 0) {
        toRemove = toRemove.map((txid) => { return '\\x' + txid })
        await this._storage.executeTransaction(async (client) => {
          await* [
            client.queryAsync(SQL.delete.transactions.unconfirmedByTxIds, [toRemove]),
            client.queryAsync(SQL.delete.history.unconfirmedByTxIds, [toRemove])
          ]
          await client.queryAsync(SQL.update.history.deleteUnconfirmedInputsByTxIds, [toRemove])
        })
      }

      // add skipped tx in our storage
      for (let txid of _.difference(nTxIds, sTxIds)) {
        setImmediate(::this._runTxImport, txid)
      }
    } catch (err) {
      logger.error(`On updating mempool: ${err.stack}`)
    }
  }

  /**
   * @param {string} txid
   */
  async _runTxImport (txid) {
    try {
      // get tx from bitcoind
      let tx = await this._network.getTx(txid)

      // ... and run import
      let imported = await this._importUnconfirmedTx(tx)
      if (imported) {
        this._importDependsFrom(txid)
      }
    } catch (err) {
      logger.error(`Tx import: ${err.stack}`)
    }
  }

  /**
   */
  async run () {
    this._latest = await this._getLatest()

    // block handler
    this._network.on('block', ::this._runBlockImport)

    // tx handler
    this._network.on('tx', ::this._runTxImport)

    // make sure that we have latest block
    await this._runBlockImport()
  }
}
