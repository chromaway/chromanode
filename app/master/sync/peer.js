/* globals Promise:true */

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')

var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('./sql')

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
    depends: {}, // txid -> txid[]
    depend: {}   // txid -> txid[]
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
    return client.queryAsync(SQL.insert.blocks.row, [
      height,
      '\\x' + block.hash,
      '\\x' + block.header.toString(),
      '\\x' + txids.join('')
    ])
  })
  .then(function () {
    // import transactions
    return Promise.map(block.transactions, function (tx, txIndex) {
      var txid = txids[txIndex]
      return client.queryAsync(SQL.select.transactions.has, ['\\x' + txid])
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
        })
    }, {concurrency: 1})
  })
  .then(function () {
    // import outputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      if (existingTx[txids[txIndex]] === true) {
        return
      }

      return Promise.map(tx.outputs, function (output, index) {
        var addresses = self._safeGetAddresses(output, txids[txIndex], index)
        return Promise.map(addresses, function (address) {
          return client.queryAsync(SQL.insert.history.confirmedOutput, [
            address,
            '\\x' + txids[txIndex],
            index,
            output.satoshis,
            '\\x' + output.script.toHex(),
            height
          ])
        }, {concurrency: 1})
      }, {concurrency: 1})
    }, {concurrency: 1})
  })
  .then(function () {
    // import inputs
    return Promise.map(block.transactions, function (tx, txIndex) {
      if (existingTx[txids[txIndex]] === true) {
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
          '\\x' + txids[txIndex],
          height,
          '\\x' + prevTxId,
          input.outputIndex
        ])
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
  var stopwatch = util.stopwatch.start()
  var txid = tx.hash

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
      var depends = _.pluck(_.filter(result, 'exists', false), 'txid')
      // some input not exists yet, mark as orphaned and delay
      if (depends.length > 0) {
        self._orphanedTx.depends[txid] = depends
        depends.forEach(function (depend) {
          self._orphanedTx.depend = _.union(self._orphanedTx.depend, [txid])
        })
        logger.warning('Found orphan tx: %s', txid)
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
          return client.queryAsync(SQL.insert.history.unconfirmedOutput, [
            address,
            '\\x' + txid,
            index,
            output.satoshis,
            '\\x' + output.script.toHex()
          ])
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
      }, {concurrency: 1})
    })
    .then(function () {
      logger.verbose('Import tx %s, elapsed time: %s',
                     txid, stopwatch.formattedValue())
      return true
    })
    .catch(TransactionsAlreadyExists, function () { return true })
    .catch(OrphanTxError, function () { return false })
  })
}

/**
 */
PeerSync.prototype.run = function () {
  var self = this

  // only one query at one momeny
  var executor = util.makeConcurrent(function (fn) {
    return fn()
  }, {concurrency: 1})

  var runBlockImport = util.makeConcurrent(function () {
    // get latest from bitcoind
    return self._network.getLatest()
      .then(function (newBlockchainLatest) {
        // .. set ..
        self._blockchainLatest = newBlockchainLatest
        // ... and run import
        return executor(function () {
          return self._updateChain()
        })
      })
  }, {concurrency: 1})

  var runTxImport = function (txid) {
    // get tx from bitcoind
    self._network.getTx(txid)
      .then(function (tx) {
        // ... and run import
        return executor(function () {
          return self._importUnconfirmedTx(tx)
        })
        .then(function (imported) {
          if (imported === false) {
            return
          }

          // check depends tx that mark as orphaned now
          var txid = tx.hash
          var orphans = self._orphanedTx.depend[txid]
          if (orphans !== undefined) {
            delete self._orphanedTx.depend[txid]
            // check every orphaned tx
            orphans.forEach(function (orphaned) {
              // all deps resolved?
              var deps = _.without(self._orphanedTx.depends[orphaned], txid)
              if (deps.length > 0) {
                self._orphanedTx.depends[orphaned] = deps
                return
              }

              // run import if all ok
              delete self._orphanedTx[orphaned]
              timers.setImmediate(runTxImport, orphaned)
            })
          }
        })
      })
  }

  return self._getMyLatest()
    .then(function (latest) {
      self._latest = latest

      // block handler
      self._network.on('block', runBlockImport)

      // tx handler
      self._network.on('tx', runTxImport)

      // make sure that we have latest block
      runBlockImport()
    })
}

module.exports = PeerSync
