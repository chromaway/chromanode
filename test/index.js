import _ from 'lodash'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import yaml from 'js-yaml'
import BitcoindRegtest from 'bitcoind-regtest'
import PUtils from 'promise-useful-utils'

import httpTests from './http'
import wsTests from './ws'
import scannerTests from './scanner'

let pg = PUtils.promisifyAll(require('pg').native)

/**
 * @param {string} path
 * @param {Array.<string>} args
 * @return {Promise.<ChildProcess>}
 */
let createProcess = async (path, args) => {
  let process = spawn(path, args, {stdio: ['ignore', 'pipe', 'pipe']})

  let onErrorExit
  try {
    await new Promise((resolve, reject) => {
      setTimeout(resolve, 500)

      onErrorExit = (code, signal) => {
        if (code instanceof Error && signal === undefined) {
          reject(code)
        }

        reject(new Error(`Exit with code = ${code} on signal = ${signal}`))
      }

      process.on('error', onErrorExit)
      process.on('exit', onErrorExit)
    })
  } finally {
    if (onErrorExit) {
      process.removeListener('error', onErrorExit)
      process.removeListener('exit', onErrorExit)
    }
  }

  process.stdout.on('error', (err) => { process.emit('error', err) })
  process.stdout.on('data', (data) => { process.emit('data', data) })
  process.stderr.on('error', (err) => { process.emit('error', err) })
  process.stderr.on('data', (data) => { process.emit('data', data) })

  return process
}

/**
 * @param {ChildProcess} process
 * @return {Promise}
 */
let killProcess = async (process) => {
  let onError
  let onExit

  try {
    await new Promise((resolve, reject) => {
      onError = reject
      onExit = async (code, signal) => {
        // why not 0 and null ?
        if (code === null && signal === 'SIGTERM') {
          return resolve()
        }

        reject(new Error(`Exit with code = ${code} on signal = ${signal}`))
      }

      process.on('error', onError)
      process.on('exit', onExit)

      process.kill('SIGTERM')
    })
  } finally {
    if (onError) { process.removeListener('error', onError) }
    if (onExit) { process.removeListener('exit', onExit) }
  }
}

describe('Run bitcoind, scanner and service', function () {
  this.timeout(30 * 1000)

  let opts = {}

  before(async () => {
    let scannerLocation = path.join(__dirname, '..', 'bin', 'scanner.js')
    let scannerConfigLocation = path.join(__dirname, 'config', 'scanner.yml')
    let scannerConfig = yaml.safeLoad(fs.readFileSync(scannerConfigLocation))

    let serviceLocation = path.join(__dirname, '..', 'bin', 'service.js')
    let serviceConfigLocation = path.join(__dirname, 'config', 'service.yml')
    let serviceConfig = yaml.safeLoad(fs.readFileSync(serviceConfigLocation))

    // clear postgresql storage
    let [client, done] = await pg.connectAsync(scannerConfig.postgresql.url)
    await client.queryAsync('BEGIN')
    let {rows} = await client.queryAsync(`SELECT
                                            tablename
                                          FROM
                                            pg_tables
                                          WHERE
                                            schemaname = 'public'
                                         `)
    for (let row of rows) {
      await client.queryAsync(`DROP TABLE ${row.tablename} cascade`)
    }
    await client.queryAsync('COMMIT')
    done()

    // extract ports
    opts.ports = {
      peer: scannerConfig.bitcoind.peer.port,
      rpc: scannerConfig.bitcoind.rpc.port,
      service: serviceConfig.chromanode.port
    }

    // run bitcoind, scanner and service
    opts.bitcoind = new BitcoindRegtest({
      wallet: {
        keysPoolSize: _.constant(10)
      },
      generate: {
        txs: {
          background: _.constant(false)
        },
        blocks: {
          background: _.constant(false)
        }
      },
      bitcoind: {
        port: _.constant(opts.ports.peer),
        rpcport: _.constant(opts.ports.rpc),
        rpcuser: _.constant(scannerConfig.bitcoind.rpc.user),
        rpcpassword: _.constant(scannerConfig.bitcoind.rpc.pass)
      }
    })
    await opts.bitcoind.ready
    let generateBlocks = opts.bitcoind.generateBlocks(110)
    opts.scanner = await createProcess(scannerLocation, ['-c', scannerConfigLocation])
    opts.service = await createProcess(serviceLocation, ['-c', serviceConfigLocation])

    // set listeners
    // opts.bitcoind.on('data', (data) => { console.warn(`Bitcoind: ${data.toString()}`) })
    opts.bitcoind.on('error', (err) => { console.warn(`Bitcoind error: ${err.stack}`) })
    // opts.bitcoind.on('exit', (code, signal) => {})

    opts.scanner.on('data', (data) => { console.warn(`Scanner: ${data.toString()}`) })
    opts.scanner.on('error', (err) => { console.warn(`Scanner error: ${err.stack}`) })
    // opts.scanner.on('exit', (code, signal) => {})

    opts.service.on('data', (data) => { console.warn(`Service: ${data.toString()}`) })
    opts.service.on('error', (err) => { console.warn(`Service error: ${err.stack}`) })
    // opts.service.on('exit', (code, signal) => {})

    await generateBlocks

    let waitTextItems = new Map()
    opts.scanner.on('data', (data) => {
      for (let [regexp, resolve] of waitTextItems.entries()) {
        if (regexp.test(data)) {
          resolve()
          waitTextItems.delete(regexp)
        }
      }
    })
    opts.waitTextInScanner = (text) => {
      return new Promise((resolve) => {
        waitTextItems.set(new RegExp(text), resolve)
      })
    }

    let latestBlockHash = (await opts.bitcoind.generateBlocks(1))[0]
    await opts.waitTextInScanner(latestBlockHash)
  })

  after(async () => {
    if (opts.bitcoind) {
      try {
        opts.bitcoind.removeAllListeners()
        await opts.bitcoind.terminate()
      } catch (err) {
        console.error(`Error on bitcoind terminating: ${err.stack}`)
      }
    }

    if (opts.scanner) {
      try {
        opts.scanner.removeAllListeners()
        // await killProcess(opts.scanner)
      } catch (err) {
        console.error(`Error on scanner terminating: ${err.stack}`)
      }
    }

    if (opts.service) {
      try {
        opts.service.removeAllListeners()
        await killProcess(opts.service)
      } catch (err) {
        console.error(`Error on service terminating: ${err.stack}`)
      }
    }
  })

  httpTests(opts)
  wsTests(opts)
  scannerTests(opts)
})
