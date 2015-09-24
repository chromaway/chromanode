import _ from 'lodash'
import { EventEmitter } from 'events'
import { setImmediate } from 'timers'
import bitcore from 'bitcore'
import ElapsedTime from 'elapsed-time'
import makeConcurrent from 'make-concurrent'
import PUtils from 'promise-useful-utils'

import config from '../lib/config'
import logger from '../lib/logger'
import { ZERO_HASH } from '../lib/const'
import util from '../lib/util'
import SQL from './sql'

let Address = bitcore.Address
let Hash = bitcore.crypto.Hash

/**
 * @event Sync#latest
 * @param {{hash: string, height: number}} latest
 */

/**
 * @event Sync#tx
 * @param {string} txid
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
   * @param {Slaves} slaves
   */
  constructor (storage, network, slaves) {
    super()

    this._storage = storage
    this._network = network
    this._slaves = slaves

    let networkName = config.get('chromanode.network')
    this._bitcoinNetwork = bitcore.Networks.get(networkName)

    this._latest = null
    this._blockchainLatest = null

    this._orphanedTx = {
      prev: {}, // txid -> txid[]
      next: {}  // txid -> txid[]
    }

    this.on('tx', ::this._importDependsFrom)
  }

  /**
   * @param {Buffer} buf
   * @param {string} type
   * @return {string}
   */
  _createAddress (buf, type) {
    let address = new Address(buf, this._bitcoinNetwork, type)
    return address.toString()
  }

  /**
   * @param {bitcore.Script} script
   * @return {string[]}
   */
  _getAddresses (script) {
    if (script.isPublicKeyHashOut()) {
      return [
        this._createAddress(script.chunks[2].buf, Address.PayToPublicKeyHash)
      ]
    }

    if (script.isScriptHashOut()) {
      return [
        this._createAddress(script.chunks[1].buf, Address.PayToScriptHash)
      ]
    }

    if (script.isMultisigOut()) {
      return script.chunks.slice(1, -2).map((chunk) => {
        let hash = Hash.sha256ripemd160(chunk.buf)
        return this._createAddress(hash, Address.PayToPublicKeyHash)
      })
    }

    if (script.isPublicKeyOut()) {
      let hash = Hash.sha256ripemd160(script.chunks[0].buf)
      return [
        this._createAddress(hash, Address.PayToPublicKeyHash)
      ]
    }

    return []
  }

  /**
   * @param {bitcore.Transaction.Output} output
   * @param {string} txid
   * @param {number} index
   * @return {string[]}
   */
  _safeGetAddresses (output, txid, index) {
    try {
      return this._getAddresses(output.script)
    } catch (err) {
      logger.error(`On get addresses for output ${txid}:${index} ${err.stack}`)
      return []
    }
  }

  /**
   * @param {Objects} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise<{hash: string, height: number}>}
   */
  _getLatest (opts) {
    let execute = ::this._storage.executeTransaction
    if (_.has(opts, 'client')) {
      execute = (fn) => { return fn(opts.client) }
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

      // run import if all resolved transactions
      delete this._orphanedTx.prev[orphaned]
      setImmediate(::this._runTxImport, orphaned)
      logger.warn(`Run import for orphaned tx: ${orphaned}`)
    }
  }

  /**
   * @param {bitcore.Transaction} tx
   * @return {Promise}
   */
  _importUnconfirmedTx = makeConcurrent((tx) => {
    let txid = tx.id

    let stopwatch = ElapsedTime.new().start()
    return this._storage.executeTransaction(async (client) => {
      // transaction already in database?
      let result = await client.queryAsync(
        SQL.select.transactions.exists, ['\\x' + txid])
      if (result.rows[0].count !== '0') {
        return
      }

      // all inputs exists?
      let txids = tx.inputs.map((i) => { return i.prevTxId.toString('hex') })
      result = await client.queryAsync(
        SQL.select.transactions.existsMany, [txids.map((i) => { return '\\x' + i })])
      let deps = _.difference(
        txids, result.rows.map((row) => { return row.txid.toString('hex') }))

      // some input not exists yet, mark as orphaned and delay
      if (deps.length > 0) {
        this._orphanedTx.prev[txid] = deps
        for (let dep of deps) {
          this._orphanedTx.next[dep] = _.union(this._orphanedTx.next[dep], [txid])
        }
        logger.warn(`Orphan tx: ${txid} (deps: ${deps.join(', ')})`)
        return
      }

      // import transaction
      let pImportTx = client.queryAsync(SQL.insert.transactions.unconfirmed, [
        '\\x' + txid,
        '\\x' + tx.toString()
      ])

      let pBroadcastTx = this._slaves.broadcastTx(txid, null, null, {client: client})

      // import intputs
      let pImportInputs = tx.inputs.map(async (input, index) => {
        let {rows} = await client.queryAsync(SQL.update.history.addUnconfirmedInput, [
          '\\x' + txid,
          '\\x' + input.prevTxId.toString('hex'),
          input.outputIndex
        ])

        return rows.map((row) => {
          let address = row.address.toString()
          return this._slaves.broadcastAddress(address, txid, null, null, {client: client})
        })
      })

      // import outputs
      let pImportOutputs = tx.outputs.map((output, index) => {
        let addresses = this._safeGetAddresses(output, txid, index)
        return addresses.map((address) => {
          let pImport = client.queryAsync(SQL.insert.history.unconfirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex()
          ])
          let pBroadcast = this._slaves.broadcastAddress(address, txid, null, null, {client: client})

          return [pImport, pBroadcast]
        })
      })

      // wait all imports and broadcasts
      await* _.flattenDeep(
        [pImportTx, pBroadcastTx, pImportInputs, pImportOutputs])

      this.emit('tx', txid)
      logger.verbose(`Import unconfirmed tx ${txid}, elapsed time: ${stopwatch.getValue()}`)
    })
    .catch((err) => {
      logger.error(`Import unconfirmed tx: ${err.stack}`)
    })
  }, {concurrency: 1})

  /**
   * @param {string} txid
   */
  async _runTxImport (txid) {
    try {
      // get tx from bitcoind
      let tx = await this._network.getTx(txid)

      // ... and run import
      await this._importUnconfirmedTx(tx)
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
  async _importBlock (block, height, client) {
    let txids = _.pluck(block.transactions, 'id')
    let existingTx = {}

    // import header
    let pImportHeader = client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ])

    // broadcast about block
    let pBroadcastHeader = this._slaves.broadcastBlock(block.hash, height, {client: client})

    // import transactions & outputs
    let pImportTxAndOutputs = await* block.transactions.map(async (tx, txIndex) => {
      let txid = txids[txIndex]
      let pBroadcastTx = this._slaves.broadcastTx(txid, block.hash, height, {client: client})

      // tx already in storage ?
      let result = await client.queryAsync(SQL.select.transactions.exists, ['\\x' + txid])

      // if already exist, mark output as confirmed and broadcast addresses
      if (result.rows[0].count !== '0') {
        existingTx[txid] = true

        let pBroadcastAddreses = PUtils.try(async () => {
          let [, {rows}] = await* [
            client.queryAsync(SQL.update.transactions.makeConfirmed, [height, '\\x' + txid]),
            client.queryAsync(SQL.update.history.makeOutputConfirmed, [height, '\\x' + txid])
          ]

          return rows.map((row) => {
            let address = row.address.toString()
            return this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client})
          })
        })

        return [pBroadcastTx, pBroadcastAddreses]
      }

      // import transaction
      let pImportTx = client.queryAsync(SQL.insert.transactions.confirmed, [
        '\\x' + txid,
        height,
        '\\x' + tx.toString()
      ])

      // import outputs only if transaction not imported yet
      let pBroadcastAddreses = await* tx.outputs.map((output, index) => {
        let addresses = this._safeGetAddresses(output, txid, index)
        return Promise.all(addresses.map(async (address) => {
          // wait output import, it's important!
          await client.queryAsync(SQL.insert.history.confirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex(),
            height
          ])

          return this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client})
        }))
      })

      return [pBroadcastTx, pImportTx, pBroadcastAddreses]
    })

    // import inputs
    let pImportInputs = block.transactions.map((tx, txIndex) => {
      let txid = txids[txIndex]
      return tx.inputs.map(async (input, index) => {
        // skip coinbase
        let prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xFFFFFFFF &&
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

        await* result.rows.map((row) => {
          let address = row.address.toString()
          return this._slaves.broadcastAddress(address, txid, block.hash, height, {client: client})
        })
      })
    })

    await* _.flattenDeep(
      [pImportHeader, pBroadcastHeader, pImportTxAndOutputs, pImportInputs])
  }

  /**
   * @return {Promise}
   */
  _runBlockImport = makeConcurrent(async () => {
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
            stopwatch.reset().start()
            this._latest = await this._storage.executeTransaction(async (client) => {
              let queries = [
                SQL.delete.blocks.fromHeight,
                SQL.update.transactions.makeUnconfirmed,
                SQL.update.history.makeOutputsUnconfirmed,
                SQL.update.history.makeInputsUnconfirmed
              ]
              for (let query of queries) {
                await client.queryAsync(query, [latest.height - 1])
              }

              return await this._getLatest({client: client})
            })
            logger.warn(`Reorg finished (back to ${latest.height - 1}), elapsed time: ${stopwatch.getValue()}`)
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
          let {rows} = await this._storage.executeQuery(
            SQL.select.blocks.txids, [this._latest.height])
          let txids = rows[0].txids.toString('hex')
          for (let i = 0, length = txids.length / 64; i < length; i += 1) {
            this.emit('tx', txids.slice(i * 64, (i + 1) * 64))
          }
        }

        break
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

    while (true) {
      // sync with bitcoind mempool
      try {
        stopwatch.reset().start()

        let [nTxIds, sTxIds] = await* [
          this._network.getMempoolTxs(),
          this._storage.executeQuery(SQL.select.transactions.unconfirmed)
        ]

        sTxIds = sTxIds.rows.map((row) => { return row.txid.toString('hex') })

        // remove tx that not in mempool but in our storage
        let rTxIds = _.difference(sTxIds, nTxIds)
        if (rTxIds.length > 0) {
          rTxIds = rTxIds.map((txid) => { return '\\x' + txid })
          await this._storage.executeTransaction(async (client) => {
            await* [
              client.queryAsync(SQL.delete.transactions.unconfirmedByTxIds, [rTxIds]),
              client.queryAsync(SQL.delete.history.unconfirmedByTxIds, [rTxIds])
            ]
            await client.queryAsync(SQL.update.history.deleteUnconfirmedInputsByTxIds, [rTxIds])
          })
        }

        // add skipped tx in our storage
        for (let txid of _.difference(nTxIds, sTxIds)) {
          setImmediate(::this._runTxImport, txid)
        }

        logger.info(`Update mempool finished, elapsed time: ${stopwatch.getValue()}`)

        break
      } catch (err) {
        logger.error(`On updating mempool: ${err.stack}`)
        await PUtils.delay(5000)
      }
    }
  }, {concurrency: 1})

  /**
   */
  async run () {
    // update latests
    this._latest = await this._getLatest()
    this._blockchainLatest = await this._network.getLatest()

    // show info message
    logger.info(`Got ${this._latest.height + 1} blocks in current db, out of ${this._blockchainLatest.height + 1} block at bitcoind`)

    // tx handler
    this._network.on('tx', ::this._runTxImport)

    // block handler
    this._network.on('block', ::this._runBlockImport)

    // make sure that we have latest block
    await this._runBlockImport()
  }
}
