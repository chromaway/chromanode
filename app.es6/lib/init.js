import 'source-map-support/register'

import yargs from 'yargs'
import fs from 'fs'
import Yaml from 'js-yaml'
import bitcore from 'bitcore-lib'

import errors from './errors'

bitcore.Networks.add({
  name: 'regtest',
  alias: 'regtest',
  pubkeyhash: 0x6f,
  privatekey: 0xef,
  scripthash: 0xc4,
  xpubkey: 0x043587cf,
  xprivkey: 0x04358394,
  networkMagic: 0xFABFB5DA,
  port: 18444,
  dnsSeeds: []
})

export default async function (app) {
  let argv = yargs
    .usage('Usage: $0 [-h] [-c CONFIG]')
    .options('c', {
      alias: 'config',
      demand: true,
      describe: 'configuration file',
      nargs: 1
    })
    .options('l', {
      alias: 'local-config',
      demand: false,
      describe: 'redefine configuration file here with JSON',
      nargs: 1
    })
    .help('h')
    .alias('h', 'help')
    .epilog('https://github.com/chromaway/chromanode')
    .version(function () { return require('./package.json').version })
    .argv

  try {
    // load config
    let config = require('./config')
    config.update(Yaml.safeLoad(fs.readFileSync(argv.config, 'utf-8')))
    if (argv['local-config'] !== undefined) {
      config.update(JSON.parse(argv['local-config']))
    }

    // load logger
    var logger = require('./logger')

    // check network
    let networkName = config.get('chromanode.network')
    if (bitcore.Networks.get(networkName) === undefined) {
      throw new errors.InvalidNetwork(name)
    }

    // run app
    await app()
  } catch (err) {
    try {
      logger.error(err)
    } catch (e) {
      console.error(err)
    }

    process.exit(0)
  }
}
