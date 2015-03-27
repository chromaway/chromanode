#!/usr/bin/env node
/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var inherits = require('util').inherits
var Promise = require('bluebird')
var RpcClient = require('bitcoind-rpc')
var timers = require('timers')
var yargs = require('yargs')

var argv = yargs
  .usage('Usage: $0 [-h] [-c CONFIG]')
  .options('c', {
    alias: 'config',
    demand: true,
    describe: 'configuration file',
    nargs: 1
  })
  .help('h')
  .alias('h', 'help')
  .epilog('https://github.com/chromaway/chromanode')
  .version(function () { return require('./package.json').version })
  .argv

// load config
var config = require('../lib/config').load(argv.config)

// load from lib after config initialization
var errors = require('../lib/errors')
var logger = require('../lib/logger').logger
var Storage = require('../lib/storage')

// logging unhadled errors
Promise.onPossiblyUnhandledRejection(function (err) {
  logger.error(err.stack || err.toString())
})

/**
 * @class Indexer
 */
function Indexer () {}

/**
 * @return {Promise}
 */
Indexer.prototype.init = function () {
  var self = this
  return Promise.try(function () {
    // check network
    self.network = bitcore.Networks.get(config.get('chromanode.network'))
    if (self.network === undefined) {
      throw new errors.InvalidNetwork(config.get('chromanode.network'))
    }

    // request info
    self.bitcoind = Promise.promisifyAll(new RpcClient(config.get('bitcoind')))
    return self.bitcoind.getInfoAsync()
  })
  .then(function (ret) {
    logger.info('Connected to bitcoind! (ver. %d)', ret.result.version)

    // init storage
    var storageOpts = _.extend(config.get('postgresql'), {
      network: config.get('chromanode.network')
    })
    self.storage = new Storage(storageOpts)
    return self.storage.init()
  })
  .then(function () {
    return Promise.all([
      self.storage.getBestBlock(),
      self.getBitcoindBestBlock()
    ])
    .spread(function (sBestBlock, bBestBlock) {
      self.bestBlock = sBestBlock
      self.bitcoindBestBlock = bBestBlock
    })
  })
}

/**
 * @return {Promise<{height: number, blockid: string}>}
 */
Indexer.prototype.getBitcoindBestBlock = function () {
  var self = this
  return self.bitcoind.getBlockCountAsync().then(function (ret) {
    var height = ret.result
    return self.bitcoind.getBlockHashAsync(height).then(function (ret) {
      return {height: height, blockid: ret.result}
    })
  })
}

/**
 * @param {number} height
 * @return {Promise<bitcore.Block>}
 */
Indexer.prototype.getBlock = function (height) {
  var self = this
  return self.bitcoind.getBlockHashAsync(height).then(function (ret) {
    return self.bitcoind.getBlockAsync(ret.result, false).then(function (ret) {
      var rawBlock = new Buffer(ret.result, 'hex')
      return new bitcore.Block(rawBlock)
    })
  })
}

/**
 * @param {pg.Client} client
 * @param {bitcore.Transaction[]} transactions
 * @param {number} [height] `undefined` for transactions in mempool
 * @return {Promise}
 */
Indexer.prototype.storeTransactions = function (client, transactions, height) {
  var indexedTransactions = _.indexBy(transactions, 'id')
  var queries = {
    blockchain: {
      storeTx: 'INSERT INTO transactions (txid, tx, height) VALUES ($1, $2, $3)'
    },
    mempool: {
      storeTx: 'INSERT INTO transactions (txid, tx) VALUES ($1, $2)'
    }
  }

  var isMempool = height === undefined
  queries = isMempool ? queries.mempool : queries.blockchain

  return transactions.reduce(function (promise, tx) {
    return promise
      .then(function () {
        var params = ['\\x' + tx.id, '\\x' + tx.toString(), height]
        if (isMempool) { params.pop() }
        return client.queryAsync(queries.storeTx, params)
      })
      .then(function () {

      })
  }, Promise.resolve())
}

function SyncComplete () {}
inherits(SyncComplete, Error)

function ReorgFound () {}
inherits(ReorgFound, Error)

/**
 * @return {Promise}
 */
Indexer.prototype.catchUp = function () {
  var self = this
  var deferred = Promise.defer()
  var mempoolTruncated = false

  function tryTruncateMempool (client) {
    if (mempoolTruncated) {
      return Promise.resolve()
    }

    mempoolTruncated = true
    return client.queryAsync('TRUNCATE transactions_mempool, history_mempool')
  }

  function once () {
    return Promise.try(function () {
      // check sync status first
      if (self.bestBlock.height + 100 < self.bitcoindBestBlock.height) {
        return
      }

      // refresh bestBlock for bitcoind
      return self.getBitcoindBestBlock().then(function (bBestBlock) {
        self.bitcoindBestBlock = bBestBlock
        if (self.bestBlock.blockid === self.bitcoindBestBlock.blockid) {
          throw new SyncComplete()
        }
      })
    })
    .then(function () {
      // reorg check
      if (self.bestBlock.height >= self.bitcoindBestBlock.height) {
        logger.warning('Reorg to height: %d', self.bitcoindBestBlock.height)
        return self.storage.executeTransaction(function (client) {
          var height = self.bitcoindBestBlock.height
          return Promise.all([
            client.queryAsync('DELETE FROM blocks WHERE height >= $1', [height]),
            client.queryAsync('DELETE FROM transactions WHERE height >= $1', [height]),
            client.queryAsync('DELETE FROM history WHERE height >= $1', [height]),
            tryTruncateMempool()
          ])
        })
        .then(function () { return self.storage.getBestBlock() })
        .then(function (sBestBlock) {
          self.bestBlock = sBestBlock
          throw new ReorgFound()
        })
      }

      // get block from bitcoind
      return self.getBlock(self.bestBlock.height + 1)
    })
    .then(function (block) {
      var height = self.bestBlock.height + 1
      return self.storage.executeTransaction(function (client) {
        var blockQuery = 'INSERT INTO blocks (height, blockid, header, txids) VALUES ($1, $2, $3, $4)'

        return tryTruncateMempool(client)
          .then(function () {
            var blockValues = [
              height,
              '\\x' + block.id,
              '\\x' + block.header.toString(),
              '\\x' + _.pluck(block.transactions, 'id').join('')
            ]
            return client.queryAsync(blockQuery, blockValues)
          })
          .then(function () {
            return self.storeTransactions(client, block.transactions, height)
          })
      })
      .then(function () {
        self.bestBlock = {height: height, blockid: block.id}
        logger.verbose('Import #%d (blockId: %s', height, block.id)
      })
    })
    .catch(ReorgFound, function () {})
    .then(function () { timers.setImmediate(once) })
    .catch(SyncComplete, function () { deferred.resolve() })
    .catch(function (err) { deferred.reject(err) })
  }

  once()

  return deferred.promise
}

/**
 * @return {Promise}
 */
Indexer.prototype.updateMempool = function () {
  return Promise.resolve()
}

/**
 */
Indexer.prototype.mainLoop = function () {
  var self = this

  function once () {
    var st = Date.now()
    self.getBitcoindBestBlock().then(function (bBestBlock) {
      self.bitcoindBestBlock = bBestBlock
      if (self.bestBlock.blockid !== self.bitcoindBestBlock.blockid) {
        return self.catchUp()
      }

      return self.updateMempool()
    })
    .finally(function () {
      var et = Date.now() - st
      var delay = config.get('chromanode.loopInterval') - et
      setTimeout(once, Math.max(0, delay))
    })
  }

  logger.info('Start from %d (blockId: %s)',
              self.bestBlock.height, self.bestBlock.blockid)
  once()
}

// create indexer, initialize and run mainLoop
var indexer = new Indexer()
indexer.init().then(indexer.mainLoop.bind(indexer))
