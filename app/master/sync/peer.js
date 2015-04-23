/* globals Promise:true */

var _ = require('lodash')
var inherits = require('util').inherits
var timers = require('timers')
var Promise = require('bluebird')

var logger = require('../../../lib/logger').logger
var util = require('../../../lib/util')
var Sync = require('./sync')
var SQL = require('./sql')

// fake error
function TransactionsAlreadyExists () {}
inherits(TransactionsAlreadyExists, Error)

/**
 * @class PeerSync
 * @extends Sync
 */
function PeerSync () {
  Sync.apply(this, arguments)
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
 * @param {bitcore.Transaction} tx
 * @return {Promise}
 */
PeerSync.prototype._importUnconfirmedTx = function (tx) {
  var self = this
  var stopwatch = util.stopwatch.start()
  var txid = tx.hash

  return self._storage.executeTransaction(function (client) {
    return Promise.try(function () {
      // transaction already in database?
      return client.queryAsync(SQL.select.transactions.has, ['\\x' + txid])
    })
    .then(function (result) {
      if (result.rows[0].count !== '0') {
        throw new TransactionsAlreadyExists()
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
        // skip coinbase
        var prevTxId = input.prevTxId.toString('hex')
        if (index === 0 &&
            input.outputIndex === 0xffffffff &&
            prevTxId === util.ZERO_HASH) {
          return
        }

        /* @todo What if output not exists yet? */
        return client.queryAsync(SQL.update.history.addUnconfirmedInput, [
          '\\x' + txid,
          '\\x' + prevTxId,
          input.outputIndex
        ])
      }, {concurrency: 1})
    })
    .then(function () {
      logger.verbose('Import tx %s, elapsed time: %s',
                     txid, stopwatch.formattedValue())
    })
    .catch(TransactionsAlreadyExists, function () {})
  })
}

/**
 */
PeerSync.prototype.run = function () {
  var self = this

  var blockImportingNow = false
  var stillNeedBlockImporting = false
  var allowBlockImporting = Promise.defer()

  var txQueue = []
  var txImportedNow = {}

  /**
   */
  function runBlockImport () {
    // set still need and return if importing block now
    if (blockImportingNow === true) {
      stillNeedBlockImporting = true
      return
    }

    // block all feature tx import operation and drop still need
    blockImportingNow = true
    stillNeedBlockImporting = false

    // resolve allow if not one tx importing now
    if (allowBlockImporting.promise.isPending() &&
        _.keys(txImportedNow).length === 0) {
      allowBlockImporting.resolve()
    }

    // get latest from network
    return self._network.getLatest()
      .then(function (newBlockchainLatest) {
        // save latest
        self._blockchainLatest = newBlockchainLatest

        // wait permission for start importing
        //   (when all import processes of current tx's will be finished)
        return allowBlockImporting.promisea
      })
      .then(function (newBlockchainLatest) {
        // update chain
        if (self._latest.hash === self._blockchainLatest.hash) {
          return
        }

        return self._updateChain()
      })
      .catch(function (err) {
        // drop block importing now and planning importing
        blockImportingNow = false
        stillNeedBlockImporting = true
        // re-throw
        throw err
      })
      .then(function () {
        // drop block importing now and
        blockImportingNow = false
      })
      .finally(function () {
        // create new permission for block import
        allowBlockImporting = Promise.defer()

        // we still need import block...
        if (stillNeedBlockImporting === true) {
          return timers.setImmediate(runBlockImport)
        }

        /* @todo update mempool */
        // run import for all tx what as planned and drop queue
        var txids = _.uniq(txQueue).reverse()
        txQueue = []
        txids.forEach(function (txid) {
          timers.setImmediate(_.partial(runTxImport, txid))
        })
      })
  }

  /**
   * @param {string} txid
   */
  function runTxImport (txid) {
    /* @todo make sequential and check for orphans */
    // skip if importing block now or planned for importing
    if (blockImportingNow === true || stillNeedBlockImporting === true) {
      return txQueue.push(txid)
    }

    // skip if txid in txImportedNow or add and continue
    if (txImportedNow[txid] !== undefined) {
      return
    }
    txImportedNow[txid] = true

    // get tx from bitcoind
    self._network.getTx(txid)
      .then(function (tx) {
        // import as unconfirmed tx
        return self._importUnconfirmedTx(tx)
      })
      .finally(function () {
        // drop from txImportedNow
        delete txImportedNow[txid]

        // allow import block if not one tx imported now
        if (_.keys(txImportedNow).length === 0 &&
            (blockImportingNow === true || stillNeedBlockImporting === true)) {
          allowBlockImporting.resolve()
        }
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
