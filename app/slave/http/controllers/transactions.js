/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var bufferEqual = require('buffer-equal')
var Promise = require('bluebird')

var errors = require('../../../../lib/errors')
var util = require('../../../../lib/util')
var SQL = require('../../sql')
var qutil = require('../util/query')

module.exports.raw = function (req, res) {
  var result = Promise.try(function () {
    var txid = '\\x' + qutil.transformTxId(req.query.txid)
    return req.storage.executeQuery(SQL.select.transactions.byTxId, [txid])
  })
  .then(function (result) {
    if (result.rowCount === 0) {
      throw new errors.Slave.TxNotFound()
    }

    return {hex: result.rows[0].tx.toString('hex')}
  })

  res.promise(result)
}

module.exports.merkle = function (req, res) {
  var result = Promise.try(function () {
    var txid = qutil.transformTxId(req.query.txid)
    return req.storage.executeTransaction(function (client) {
      return client.queryAsync(SQL.select.transactions.byTxId, ['\\x' + txid])
        .then(function (result) {
          if (result.rowCount === 0) {
            throw new errors.Slave.TxNotFound()
          }

          if (result.rows[0].height === null) {
            return {source: 'mempool'}
          }

          var height = result.rows[0].height
          return client.queryAsync(SQL.select.blocks.txids, [height])
            .then(function (result) {
              var stxids = result.rows[0].txids.toString('hex')
              var txids = []
              for (var cnt = stxids.length / 64, idx = 0; idx < cnt; idx += 1) {
                txids.push(stxids.slice(idx * 64, (idx + 1) * 64))
              }

              var merkle = []
              var hashes = txids.map(util.decode)
              var targetHash = util.decode(txid)
              while (hashes.length !== 1) {
                if (hashes.length % 2 === 1) {
                  hashes.push(_.last(hashes))
                }

                var nHashes = []
                for (cnt = hashes.length, idx = 0; idx < cnt; idx += 2) {
                  var nHashSrc = Buffer.concat([hashes[idx], hashes[idx + 1]])
                  var nHash = bitcore.crypto.Hash.sha256sha256(nHashSrc)
                  nHashes.push(nHash)

                  if (bufferEqual(hashes[idx], targetHash)) {
                    merkle.push(util.encode(hashes[idx + 1]))
                    targetHash = nHash
                  } else if (bufferEqual(hashes[idx + 1], targetHash)) {
                    merkle.push(util.encode(hashes[idx]))
                    targetHash = nHash
                  }
                }
                hashes = nHashes
              }

              return {
                source: 'blocks',
                block: {
                  height: height,
                  hash: result.rows[0].hash.toString('hex'),
                  merkle: merkle,
                  index: txids.indexOf(txid)
                }
              }
            })
        })
    })
  })

  res.promise(result)
}

module.exports.send = function (req, res) {
  res.promise(req.master.sendTx(req.body.rawtx))
}
