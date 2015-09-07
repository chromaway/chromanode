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
        SQL.select.transactions.has, ['\\x' + txid])

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

        // TODO make wrong confirmed '(
        result = await client.queryAsync(
          SQL.update.history.makeConfirmed, [height, '\\x' + txid])

        for (let row of result.rows) {
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
      if (existingTx[txid] === true) {
        return
      }

      return Promise.all(tx.inputs.map(async (input, index) => {
        // skip coinbase
        let prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === ZERO_HASH) {
          return
        }

        let {rows} = await client.queryAsync(SQL.update.history.addConfirmedInput, [
          '\\x' + txid,
          height,
          '\\x' + prevTxId,
          input.outputIndex
        ])

        for (let row of rows) {
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
    /*
     * @param {string} txid
     * @param {pg.Client} client
     * @return {Promise<boolean>}
     */
    let hasTx = async (txid, client) => {
      let {rows} = await client.queryAsync(
        SQL.select.transactions.has, ['\\x' + txid])

      return rows[0].count !== '0'
    }

    let txid = tx.hash

    let stopwatch = ElapsedTime.new().start()
    return this._storage.executeTransaction(async (client) => {
      // transaction already in database?
      let alreadyExists = await hasTx(txid, client)
      if (alreadyExists) {
        return false
      }

      // all inputs exists?
      let deps = _.filter(await* tx.inputs.map(async (input) => {
        let txid = input.prevTxId.toString('hex')
        let exists = await hasTx(txid, client)
        if (!exists) {
          return txid
        }
      }))

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
    try {
      this._blockchainLatest = await this._network.getLatest()

      let updated = await this._updateChain()
      if (updated === false) {
        return
      }

      logger.info(`New latest! ${this._latest.hash}:${this._latest.height}`)

      this.emit('latest', this._latest)

      // update orphaned tx's
      let result = await this._storage.executeQuery(
        SQL.select.blocks.txids, [this._latest.height])

      let txids = result.rows[0].txids.toString('hex')
      for (; txids.length !== 0; txids = txids.slice(32)) {
        let txid = txids.slice(0, 32)
        setImmediate(::this._importDependsFrom, txid)
        this.emit('tx', txid)
      }

      // sync with bitcoind mempool
      let [nTxIds, sTxIds] = await Promise.all([
        this._network.getMempoolTxs(),
        this._storage.executeQuery(SQL.select.transactions.unconfirmed)
      ])

      sTxIds = sTxIds.rows.map((row) => { return row.txid.toString('hex') })

      let toRemove = _.difference(sTxIds, nTxIds)
      if (toRemove.length > 0) {
        toRemove = toRemove.map((txid) => { return '\\x' + txid })
        await this._storage.executeTransaction((client) => {
          return Promise.all([
            client.queryAsync(SQL.delete.transactions.unconfirmedByTxIds, [toRemove]),
            client.queryAsync(SQL.delete.history.unconfirmedByTxIds, [toRemove]),
            client.queryAsync(SQL.update.history.deleteUnconfirmedInputsByTxIds, [toRemove])
          ])
        })
      }

      for (let txid of _.difference(nTxIds, sTxIds)) {
        setImmediate(::this._runTxImport, txid)
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
