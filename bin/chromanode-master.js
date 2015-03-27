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

// logging unhadled errors
Promise.onPossiblyUnhandledRejection(function (err) {
  logger.error(err.stack || err.toString())
})

var storageOpts = _.extend(config.get('postgresql'), {network: config.get('chromanode.network')})

// shared objects
var network = bitcore.Networks.get(config.get('chromanode.network'))
var bitcoind = Promise.promisifyAll(new RpcClient(config.get('bitcoind')))
var storage = new Storage(storageOpts)

// pre sync and run ???
Promise.try(function () {
  // check network
  if (network === undefined) {
    throw new errors.InvalidNetwork(config.get('chromanode.network'))
  }

  // request info
  return bitcoind.getInfoAsync()
})
.then(function (info) {
  logger.info('Connected to bitcoind! (ver. %d)', info.result.version)

  // init storage
  return storage.init()
})
