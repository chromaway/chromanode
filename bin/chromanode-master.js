#!/usr/bin/env node
/* globals Promise:true */

var bitcore = require('bitcore')
var Promise = require('bluebird')
var RpcClient = require('bitcoind-rpc')
var yargs = require('yargs')

var errors = require('../lib/errors')

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

// logging unhadled errors
var logger = require('../lib/logger').logger
Promise.onPossiblyUnhandledRejection(function (err) {
  logger.error(err.stack || err.toString())
})

// shared objects
var network
var bitcoind

//
Promise.try(function () {
  // check network
  network = bitcore.Networks.get(config.get('chromanode.network'))
  if (network === undefined) {
    throw new errors.InvalidNetwork(config.get('chromanode.network'))
  }

  // connect to bitcoind and request info
  bitcoind = Promise.promisifyAll(new RpcClient(config.get('bitcoind')))
  return bitcoind.getInfoAsync()
})
.then(function (info) {
  logger.info('Connected to bitcoind! (ver. %d)', info.result.version)

  // init storage
})
