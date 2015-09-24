import _ from 'lodash'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import yaml from 'js-yaml'
import BitcoindRegtest from 'bitcoind-regtest'
import PUtils from 'promise-useful-utils'

import httpTests from './http'
import wsTests from './ws'

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

describe('Run bitcoind, master and slave', function () {
  this.timeout(30 * 1000)

  let opts = {}

  before(async () => {
    let masterLocation = path.join(__dirname, '..', 'bin', 'chromanode-master.js')
    let masterConfigLocation = path.join(__dirname, 'config', 'master.yml')
    let masterConfig = yaml.safeLoad(fs.readFileSync(masterConfigLocation))

    let slaveLocation = path.join(__dirname, '..', 'bin', 'chromanode-slave.js')
    let slaveConfigLocation = path.join(__dirname, 'config', 'slave.yml')
    let slaveConfig = yaml.safeLoad(fs.readFileSync(slaveConfigLocation))

    // clear postgresql storage
    let [client, done] = await pg.connectAsync(masterConfig.postgresql.url)
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
      peer: masterConfig.bitcoind.peer.port,
      rpc: masterConfig.bitcoind.rpc.port,
      slave: slaveConfig.chromanode.port
    }

    // run bitcoind, master and slave
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
        rpcuser: _.constant(masterConfig.bitcoind.rpc.user),
        rpcpassword: _.constant(masterConfig.bitcoind.rpc.pass)
      }
    })
    await opts.bitcoind.ready
    let generateBlocks = opts.bitcoind.generateBlocks(105)
    opts.master = await createProcess(masterLocation, ['-c', masterConfigLocation])
    opts.slave = await createProcess(slaveLocation, ['-c', slaveConfigLocation])

    // set listeners
    // opts.bitcoind.on('data', (data) => { console.warn(`Bitcoind: ${data.toString()}`) })
    opts.bitcoind.on('error', (err) => { console.warn(`Bitcoind error: ${err.stack}`) })
    // opts.bitcoind.on('exit', (code, signal) => {})

    opts.master.on('data', (data) => { console.warn(`Master: ${data.toString()}`) })
    opts.master.on('error', (err) => { console.warn(`Master error: ${err.stack}`) })
    // opts.master.on('exit', (code, signal) => {})

    opts.slave.on('data', (data) => { console.warn(`Slave: ${data.toString()}`) })
    opts.slave.on('error', (err) => { console.warn(`Slave error: ${err.stack}`) })
    // opts.slave.on('exit', (code, signal) => {})

    await generateBlocks
    await new Promise((resolve, reject) => {
      PUtils.try(async () => {
        let latestBlockHash
        let waitLatestBlockHash = (data) => {
          if (latestBlockHash && latestBlockHash.test(data.toString())) {
            opts.master.removeListener('data', waitLatestBlockHash)
            resolve()
          }
        }
        opts.master.on('data', waitLatestBlockHash)
        latestBlockHash = new RegExp(
          (await opts.bitcoind.generateBlocks(1))[0])
      })
      .catch(reject)
    })
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

    if (opts.master) {
      try {
        opts.master.removeAllListeners()
        // await killProcess(opts.master)
      } catch (err) {
        console.error(`Error on master terminating: ${err.stack}`)
      }
    }

    if (opts.slave) {
      try {
        opts.slave.removeAllListeners()
        await killProcess(opts.slave)
      } catch (err) {
        console.error(`Error on slave terminating: ${err.stack}`)
      }
    }
  })

  httpTests(opts)
  wsTests(opts)
})
