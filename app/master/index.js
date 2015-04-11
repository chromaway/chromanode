/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var inherits = require('util').inherits
var Promise = require('bluebird')
var timers = require('timers')

var Address = bitcore.Address
var Hash = bitcore.crypto.Hash

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var messages = require('../../lib/messages').default()
var storage = require('../../lib/storage').default()
var bitcoind = require('./bitcoind').default()
var db = require('./db').default()
var slaves = require('./slaves').default()

/**
 * @class Master
 */
function Master () {
  /* @todo save to db */
  /* @todo not notify if syncing */
  this.isSyncing = true
}

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  slaves.on('sendTx', function (id, rawtx) {
    bitcoind.sendTx(rawtx)
      .then(function () { return })
      .catch(function (err) {
        if (err instanceof Error) {
          return {code: null, message: err.message}
        }

        return err
      })
      .then(function (ret) {
        return storage.execute(function (client) {
          return slaves.sendTxResponse(client, id, ret)
        })
      })
  })

  function once () {
    var st = Date.now()
    return Promise.all([db.getLatest(), bitcoind.getLatest()])
      .spread(function (latest, bitcoindLatest) {
        if (latest.blockid !== bitcoindLatest.blockid) {
          return self.catchUp().then(function () { self.isSyncing = false })
        }

        return self.updateMempool()
      })
      .finally(function () {
        var et = Date.now() - st
        var delay = config.get('chromanode.updateInterval') - et
        setTimeout(once, Math.max(0, delay))
      })
  }

  return bitcoind.init()
    .then(function () { return storage.init() })
    .then(function () { return messages.init() })
    .then(function () { return slaves.init() })
    .then(function () { return db.getLatest() })
    .then(function (latest) {
      logger.info('Start from %d (blockId: %s)', latest.height, latest.blockid)
      timers.setImmediate(once)
    })
}

/**
 * @param {pg.Client} client
 * @param {bitcore.Transaction[]} transactions
 * @param {number} [height] `undefined` for transactions in mempool
 * @return {Promise}
 */
Master.prototype.storeTransactions = function (client, transactions, height) {
  var queries = {
    blockchain: {
      storeTx: 'INSERT INTO transactions (txid, tx, height) VALUES ($1, $2, $3)',
      storeIn: 'INSERT INTO history' +
               '  (address, txid, index, prevtxid, outputindex, value, height)' +
               '  VALUES ($1, $2, $3, $4, $5, NULL, $6)',
      storeOut: 'INSERT INTO history' +
                '  (address, txid, index, prevtxid, outputindex, value, height)' +
                '  VALUES ($1, $2, $3, NULL, NULL, $4, $5)'
    },
    mempool: {
      storeTx: 'INSERT INTO transactions_mempool (txid, tx) VALUES ($1, $2)',
      storeIn: 'INSERT INTO history_mempool' +
               '  (address, txid, index, prevtxid, outputindex, value)' +
               '  VALUES ($1, $2, $3, $4, $5, NULL)',
      storeOut: 'INSERT INTO history_mempool' +
                '  (address, txid, index, prevtxid, outputindex, value)' +
                '  VALUES ($1, $2, $3, NULL, NULL, $4)'
    }
  }

  var selectAddresses = [
    'SELECT address FROM history WHERE txid = $1 AND index = $2',
    'SELECT address FROM history_mempool WHERE txid = $1 AND index = $2'
  ]

  var network = bitcore.Networks.get(config.get('chromanode.network'))
  var indexedTransactions = _.indexBy(transactions, 'id')
  var isMempool = height === undefined
  queries = isMempool ? queries.mempool : queries.blockchain

  function saveTx (tx) {
    var params = ['\\x' + tx.id, '\\x' + tx.toString()]
    if (!isMempool) { params.push(height) }
    return client.queryAsync(queries.storeTx, params)
  }

  function getInScriptAddresses (script, txid, outindex) {
    if (script.isPublicKeyHashIn()) {
      var hash = Hash.sha256ripemd160(script.chunks[1].buf)
      return Promise.resolve([new Address(hash, network, Address.PayToPublicKeyHash).toString()])
    }

    // first check current block
    var tx = indexedTransactions[txid]
    if (tx !== undefined) {
      var addresses = getOutScriptAddresses(tx.outputs[outindex].script)
      return Promise.resolve(_.invoke(addresses, 'toString'))
    }

    /* @todo what if output not in db yet ? */
    /* @todo If sync is finished check mempool first! */
    // load from storage
    var params = ['\\x' + txid, outindex]
    return client.queryAsync(selectAddresses[0], params)
      .then(function (res) {
        if (res.rows.length > 0) {
          return _.pluck(res.rows, 'address')
        }

        return client.queryAsync(selectAddresses[1], params)
          .then(function (res) {
            return _.pluck(res.rows, 'address')
          })
      })
  }

  function saveInputs (tx) {
    var txid = tx.id
    return Promise.map(tx.inputs, function (input, index) {
      var prevTxId = input.prevTxId.toString('hex')
      if (prevTxId === '0000000000000000000000000000000000000000000000000000000000000000' &&
          input.outputIndex === 0xffffffff) {
        return
      }

      var params = ['\\x' + txid, index, '\\x' + prevTxId, input.outputIndex]
      if (!isMempool) { params.push(height) }

      return getInScriptAddresses(input.script, prevTxId, input.outputIndex)
        .then(function (addresses) {
          var promises = []
          addresses.forEach(function (address) {
            promises.push(slaves.addressTouched(client, address, txid))
            promises.push(client.queryAsync(queries.storeIn, [address].concat(params)))
          })
          return Promise.all(promises)
        })

    }, {concurrency: 1})
  }

  function getOutScriptAddresses (script) {
    if (script.isPublicKeyHashOut() && script.chunks[2].len === 20) {
      return [new Address(script.chunks[2].buf, network, Address.PayToPublicKeyHash)]
    }

    if (script.isScriptHashOut()) {
      return [new Address(script.chunks[1].buf, network, Address.PayToScriptHash)]
    }

    if (script.isMultisigOut()) {
      return script.chunks.slice(1, -2).map(function (chunk) {
        var hash = Hash.sha256ripemd160(chunk.buf)
        return new Address(hash, network, Address.PayToPublicKeyHash)
      })
    }

    if (script.isPublicKeyOut()) {
      var hash = Hash.sha256ripemd160(script.chunks[0].buf)
      return [new Address(hash, network, Address.PayToPublicKeyHash)]
    }

    return []
  }

  function saveOutputs (tx) {
    var txid = tx.id
    return Promise.map(tx.outputs, function (output, index) {
      // script validation
      try { output.script } catch (e) { return }

      var params = ['\\x' + txid, index, output.satoshis]
      if (!isMempool) { params.push(height) }

      var promises = []
      getOutScriptAddresses(output.script).forEach(function (address) {
        address = address.toString()
        promises.push(slaves.addressTouched(client, address, txid))
        promises.push(client.queryAsync(queries.storeOut, [address].concat(params)))
      })
      return Promise.all(promises)

    }, {concurrency: 1})
  }

  return Promise.all(transactions.map(function (tx) {
    return saveTx(tx)
      .then(function () { return saveInputs(tx) })
      .then(function () { return saveOutputs(tx) })
  }))
}

function SyncComplete () {}
inherits(SyncComplete, Error)

function ReorgFound () {}
inherits(ReorgFound, Error)

/**
 * @return {Promise}
 */
Master.prototype.catchUp = function () {
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

  function runReorg (height) {
    logger.warn('Reorg to height: %d', height)
    return storage.executeTransaction(function (client) {
      return Promise.all([
        client.queryAsync('DELETE FROM blocks WHERE height > $1', [height]),
        client.queryAsync('DELETE FROM transactions WHERE height > $1', [height]),
        client.queryAsync('DELETE FROM history WHERE height > $1', [height]),
        tryTruncateMempool(client)
      ])
    })
    .then(function () { throw new ReorgFound() })
  }

  function once () {
    return Promise.all([db.getLatest(), bitcoind.getLatest()])
      .spread(function (latest, bitcoindLatest) {
        if (latest.blockid === bitcoindLatest.blockid) {
          throw new SyncComplete()
        }

        // get block from bitcoind
        return Promise.all([latest, bitcoind.getBlock(latest.height + 1)])
      })
      .spread(function (latest, block) {
        // reorg check
        var prevHash = new Buffer(block.header.prevHash)
        var prevBlockid = Array.prototype.reverse.call(prevHash).toString('hex')
        if (latest.blockid !== prevBlockid) {
          return runReorg(latest.height - 1)
        }

        var height = latest.height + 1
        return storage.executeTransaction(function (client) {
          var blockQuery = 'INSERT INTO blocks (height, blockid, header, txids) VALUES ($1, $2, $3, $4)'
          var blockValues = [
            height,
            '\\x' + block.id,
            '\\x' + block.header.toString(),
            '\\x' + _.pluck(block.transactions, 'id').join('')
          ]

          return Promise.all([
            tryTruncateMempool(client),
            client.queryAsync(blockQuery, blockValues),
            slaves.newBlock(client, block.id, height),
            self.storeTransactions(client, block.transactions, height)
          ])
        })
        .then(function () {
          /* @todo show progress when syncing and this message when finished */
          logger.verbose('Import #%d (blockId: %s)', height, block.id)
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
Master.prototype.updateMempool = function () {
  var self = this
  return storage.executeTransaction(function (client) {
    return Promise.all([
      client.queryAsync('SELECT txid FROM transactions_mempool'),
      bitcoind.getRawMemPool()
    ])
    .spread(function (sres, bres) {
      sres = _.pluck(sres.rows, 'txid').map(function (buf) {
        return buf.toString('hex')
      })
      var oldtxs = _.difference(sres, bres)

      return Promise.map(oldtxs, function (txid) {
        txid = '\\x' + txid
        return Promise.all([
          client.queryAsync('DELETE FROM transactions_mempool WHERE txid = $1', [txid]),
          client.queryAsync('DELETE FROM history_mempool WHERE txid = $1', [txid])
        ])
      })
      .then(function () {
        return bitcoind.getTransactions(_.difference(bres, sres))
      })
      .then(function (newtxs) {
        return self.storeTransactions(client, newtxs)
      })
      .then(function () {
        var diff = _.difference(bres, sres).length - oldtxs.length
        if (diff >= 0) { diff = '+' + diff.toString() }
        logger.verbose('Mempool updated... %s transactions', diff.toString())
      })
    })
  })
}

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var master = new Master()
  return master.init()
}
