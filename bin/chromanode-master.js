#!/usr/bin/env node
/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var Promise = require('bluebird')
var RpcClient = require('bitcoind-rpc')
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
var util = require('../lib/util')

// logging unhadled errors
Promise.onPossiblyUnhandledRejection(function (err) {
  logger.error(err.stack || err.toString())
})

// create indexer, initialize and run mainLoop
var indexer = new Indexer()
indexer.init().then(indexer.mainLoop.bind(indexer))

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
      self.bestBlock = sBestBlock || {height: -1, blockid: util.zfill('', 64)}
      self.bitcoindBestBlock = bBestBlock
    })
  })
}

/**
 * @return {Promise<{height: number, blockid: string}>}
 */
Indexer.prototype.getBitcoindBestBlock = function () {
  var self = this
  return self.bitcoind.getInfoAsync().then(function (ret) {
    var height = ret.result.blocks
    return self.bitcoind.getBlockHashAsync(height).then(function (ret) {
      return {height: height, blockid: ret.result}
    })
  })
}

/**
 * @return {Promise}
 */
Indexer.prototype.catchUp = function () {
  return Promise.resolve()
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

  once()
}
