/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var bufferEqual = require('buffer-equal')
var Promise = require('bluebird')

var errors = require('../../../../lib/errors')
var util = require('../../../../lib/util')
var SQL = require('../../sql')
var qutil = require('../util/query')

var v1 = module.exports.v1 = {}
var v2 = module.exports.v2 = {}

v1.raw = v2.raw = function (req, res) {
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

v1.merkle = v2.merkle = function (req, res) {
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

v1.send = v2.send = function (req, res) {
  res.promise(req.master.sendTx(req.body.rawtx))
}


v2.spent = function (req, res) {
  var result = Promise.try(function () {
    var otxid = '\\x' + qutil.transformTxId(req.query.otxid)
    var oindex = parseInt(req.query.oindex, 10)
    return req.storage.executeQuery(SQL.select.history.spent, [otxid, oindex])
  })
  .then(function (result) {
    if (result.rowCount === 0) {
      throw new errors.Slave.TxNotFound()
    }

    var retval;
    var row = result.rows[0]
    if (row.itxid) {
      var itxid = row.itxid.toString('hex')
      var iheight = row.iheight
      retval = {
        spent: true,
        itxid: itxid,
        iheight: iheight
      }
    } else {
      retval = {
        spent: false
      }
    }
    return retval;
  })

  res.promise(result)
}