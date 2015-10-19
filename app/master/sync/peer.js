'use strict'

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')

var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('../sql')

// fake errors
function TransactionsAlreadyExists () {}
inherits(TransactionsAlreadyExists, Error)
function OrphanTxError () {}
inherits(OrphanTxError, Error)

/**
 * @class PeerSync
 * @extends Sync
 */
function PeerSync () {
  Sync.apply(this, arguments)

  this._orphanedTx = {
    prev: {}, // txid -> txid[]
    next: {}  // txid -> txid[]
  }
}

inherits(PeerSync, Sync)

/**
 * @param {number} height
 * @return {Promise<bitcore.block>}
 */
PeerSync.prototype._getBlock = function (height) {
  var stopwatch = util.stopwatch.start()
  return this._network.getBlock(height)
    .then(function (block) {
      logger.verbose('Downloading block %d, elapsed time: %s',
                     height, stopwatch.formattedValue())
      return block
    })
}

/**
 * @param {bitcore.Block} block
 * @param {number} height
 * @param {pg.Client} client
 * @return {Promise}
 */
PeerSync.prototype._importBlock = function (block, height, client) {
  var self = this

  var txids = _.pluck(block.transactions, 'hash')
  var existingTx = {}

  return Promise.try(function () {
    // import header
    var insert = client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ])

    var broadcast = self._slaves.broadcastBlock(
      block.hash, height, {client: client})

    return Promise.all([insert, broadcast])
  })
  .then(function () {
    // import transactions
    return Promise.map(block.transactions, function (tx, txIndex) {
      var txid = txids[txIndex]

      var insert = client.queryAsync(
        SQL.select.transactions.has, ['\\x' + txid]
      )
      .then(function (result) {
        if (result.rows[0].count === '0') {
          return client.queryAsync(SQL.insert.transactions.confirmed, [
            '\\x' + txid,
            height,
            '\\x' + tx.toString()
          ])
        }

        existingTx[txid] = true
        return self._storage.executeQueries([
          [SQL.update.transactions.makeConfirmed, [height, '\\x' + txid]],
          [SQL.update.history.makeConfirmed, [height, '\\x' + txid]]
        ], {concurrency: 1, client: client})
        .then(function (results) {
          var promises = _.chain(results[1].rows)
            .pluck('address')
            .invoke('toString', 'hex')
            .map(function (address) {
              return self._slaves.broadcastAddress(
                address, txid, block.hash, height, {client: client})
            })
            .value()

          return Promise.all(promises)
        })
      })

      var broadcast = self._slaves.broadcastTx(
        txid, block.hash, height, {client: client})

      return Promise.all([insert, broadcast])
    }, {concurrency: 1})
  })
  .then(function () {
    // import outputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      var txid = txids[txIndex]
      if (existingTx[txid] === true) {
        return
      }

      return Promise.map(tx.outputs, function (output, index) {
        var addresses = self._safeGetAddresses(output, txid, index)
        return Promise.map(addresses, function (address) {
          var insert = client.queryAsync(SQL.insert.history.confirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex(),
            height
          ])

          var broadcast = self._slaves.broadcastAddress(
            address, txid, block.hash, height, {client: client})

          return Promise.all([insert, broadcast])
        }, {concurrency: 1})
      }, {concurrency: 1})
    }, {concurrency: 1})
  })
  .then(function () {
    // import inputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      var txid = txids[txIndex]
      if (existingTx[txid] === true) {
        return
      }

      return Promise.map(tx.inputs, function (input, index) {
        // skip coinbase
        var prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === util.ZERO_HASH) {
          return
        }

        return client.queryAsync(SQL.update.history.addConfirmedInput, [
          '\\x' + txid,
          height,
          '\\x' + prevTxId,
          input.outputIndex
        ])
        .then(function (result) {
          var promises = _.chain(result.rows)
            .pluck('address')
            .invoke('toString', 'hex')
            .map(function (address) {
              return self._slaves.broadcastAddress(
                address, txid, block.hash, height, {client: client})
            })
            .value()

          return Promise.all(promises)
        })
      }, {concurrency: 1})
    }, {concurrency: 1})
  })
}

/**
 * @param {string} txid
 * @param {pg.Client} client
 * @return {Promise<boolean>}
 */
PeerSync.prototype._hasTx = function (txid, client) {
  return client.queryAsync(SQL.select.transactions.has, ['\\x' + txid])
    .then(function (result) { return result.rows[0].count !== '0' })
}

/**
 * @param {bitcore.Transaction} tx
 * @return {Promise<boolean>}
 */
PeerSync.prototype._importUnconfirmedTx = function (tx) {
  var self = this
  var txid = tx.hash

  var stopwatch = util.stopwatch.start()
  return self._storage.executeTransaction(function (client) {
    return Promise.try(function () {
      // transaction already in database?
      return self._hasTx(txid, client)
    })
    .then(function (alreadyExists) {
      if (alreadyExists) {
        throw new TransactionsAlreadyExists()
      }

      // all inputs exists?
      return Promise.map(tx.inputs, function (input) {
        var txid = input.prevTxId.toString('hex')
        return self._hasTx(txid, client)
          .then(function (exists) { return {txid: txid, exists: exists} })
      })
    }).then(function (result) {
      var deps = _.pluck(_.filter(result, 'exists', false), 'txid')
      // some input not exists yet, mark as orphaned and delay
      if (deps.length > 0) {
        self._orphanedTx.prev[txid] = deps
        deps.forEach(function (dep) {
          self._orphanedTx.next[dep] = _.union(self._orphanedTx.next[dep], [txid])
        })
        logger.warn('Found orphan tx: %s (deps: %s)',
                    txid, deps.join(','))
        throw new OrphanTxError()
      }

      // import transaction
      return client.queryAsync(SQL.insert.transactions.unconfirmed, [
        '\\x' + txid,
        '\\x' + tx.toString()
      ])
    })
    .then(function () {
      // import outputs
      return Promise.map(tx.outputs, function (output, index) {
        var addresses = self._safeGetAddresses(output, txid, index)
        return Promise.map(addresses, function (address) {
          var insert = client.queryAsync(SQL.insert.history.unconfirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex()
          ])
          var broadcast = self._slaves.broadcastAddress(
            address, txid, null, null, {client: client})

          return Promise.all([insert, broadcast])
        }, {concurrency: 1})
      }, {concurrency: 1})
    })
    .then(function () {
      // import intputs
      return Promise.map(tx.inputs, function (input, index) {
        return client.queryAsync(SQL.update.history.addUnconfirmedInput, [
          '\\x' + txid,
          '\\x' + input.prevTxId.toString('hex'),
          input.outputIndex
        ])
        .then(function (result) {
          var promises = _.chain(result.rows)
            .pluck('address')
            .invoke('toString', 'hex')
            .map(function (address) {
              return self._slaves.broadcastAddress(
                address, txid, null, null, {client: client})
            })
            .value()

          return Promise.all(promises)
        })
      }, {concurrency: 1})
    })
    .then(function () {
      return self._slaves.broadcastTx(txid, null, null, {client: client})
    })
    .then(function () { return true })
    .catch(TransactionsAlreadyExists, function () { return true })
    .catch(OrphanTxError, function () { return false })
  })
  .then(function (value) {
    logger.verbose('Import tx %s, elapsed time: %s',
                   txid, stopwatch.formattedValue())
    return value
  })
}

/**
 * @return {Promise}
 */
PeerSync.prototype._updateMempool = function () {
  var self = this
  return Promise.all([
    self._network.getMempoolTxs(),
    self._storage.executeQuery(SQL.select.transactions.unconfirmed)
  ])
  .spread(function (nTxIds, mTxIds) {
    mTxIds = mTxIds.rows.map(function (row) {
      return row.txid.toString('hex')
    })

    var toRemove = _.difference(mTxIds, nTxIds)
    var toAdd = _.difference(nTxIds, mTxIds)

    return Promise.try(function () {
      if (toRemove.length === 0) {
        return
      }

      toRemove = toRemove.map(function (txid) { return '\\x' + txid })
      return self._storage.executeQueries([
        [SQL.delete.transactions.unconfirmedByTxIds, [toRemove]],
        [SQL.delete.history.unconfirmedByTxIds, [toRemove]],
        [SQL.update.history.deleteUnconfirmedInputsByTxIds, [toRemove]]
      ], {concurrency: 1})
    })
    .then(function () {
      toAdd.forEach(self._runTxImport.bind(self))
    })
  })
}

/**
 * @param {string} txid
 */
PeerSync.prototype._importDependsFrom = function (txid) {
  var self = this
  // check depends tx that mark as orphaned now
  var orphans = self._orphanedTx.next[txid]
  if (orphans !== undefined) {
    delete self._orphanedTx.next[txid]
    // check every orphaned tx
    orphans.forEach(function (orphaned) {
      // all deps resolved?
      var deps = _.without(self._orphanedTx.prev[orphaned], txid)
      if (deps.length > 0) {
        self._orphanedTx.prev[orphaned] = deps
        return
      }

      // run import if all ok
      delete self._orphanedTx.prev[orphaned]
      timers.setImmediate(self._runTxImport.bind(self), orphaned)
      logger.warn('Run import for orphaned tx: %s', orphaned)
    })
  }
}

/**
 * @param {function} fn
 * @return {Promise}
 */
PeerSync.prototype._executor = util.makeConcurrent(function (fn) {
  return fn()
}, {concurrency: 1})

/**
 * @return {Promise}
 */
PeerSync.prototype._runBlockImport = util.makeConcurrent(function () {
  var self = this
  // get latest from bitcoind
  return self._network.getLatest()
    .then(function (newBlockchainLatest) {
      // set and run import
      self._blockchainLatest = newBlockchainLatest
      return self._executor(function () {
        return self._updateChain()
          .then(function (updated) {
            if (updated === false) {
              return
            }

            logger.info('New latest! %s:%s',
                        self._latest.hash, self._latest.height)

            self.emit('latest', self._latest)

            return self._storage.executeQuery(
              SQL.select.blocks.txids, [self._latest.height]
            )
            .then(function (result) {
              var txids = result.rows[0].txids.toString('hex')
              for (; txids.length !== 0; txids = txids.slice(32)) {
                var txid = txids.slice(0, 32)
                self._importDependsFrom(txid)
              }
            })
            .then(function () {
              return self._updateMempool()
            })
          })
      })
    })
}, {concurrency: 1})

/**
 * @return {Promise}
 */
PeerSync.prototype._runTxImport = function (txid) {
  var self = this
  // get tx from bitcoind
  return self._network.getTx(txid)
    .then(function (tx) {
      // ... and run import
      return self._executor(function () {
        return self._importUnconfirmedTx(tx)
      })
      .then(function (imported) {
        if (imported === true) {
          return self._importDependsFrom(txid)
        }
      })
    })
}

/**
 */
PeerSync.prototype.run = function () {
  var self = this
  return self._getMyLatest()
    .then(function (latest) {
      self._latest = latest

      // block handler
      self._network.on('block', self._runBlockImport.bind(self))

      // tx handler
      self._network.on('tx', self._runTxImport.bind(self))

      // make sure that we have latest block
      self._runBlockImport()
        .then(function () {
          return self._executor(self._updateMempool.bind(self))
        })
    })
}

module.exports = PeerSync
