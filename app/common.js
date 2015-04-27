#!/usr/bin/env node
/* globals Promise:true */
var Promise = require('bluebird')
var yargs = require('yargs')

module.exports.run = function (init) {
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
    logger.error('Unhandled error: %s', err)
  })

  // check network
  require('../lib/util').checkNetwork(config.get('chromanode.network'))

  // initialize
  init().catch(function (err) {
    logger.error('Error on initialization: %s', err.stack)
    process.exit(1)
  })
}
