/* globals Promise:true */

var Promise = require('bluebird')

var db = require('../../db').default()
var master = require('../../master').default()
var qutil = require('../util/query')

module.exports.raw = function (req, res) {
  var result = Promise.try(function () {
    var txid = qutil.transformTxId(req.query.txid)
    return db.getRawTransaction(txid)
  })

  res.promise(result)
}

module.exports.merkle = function (req, res) {
  var result = Promise.try(function () {
    var txid = qutil.transformTxId(req.query.txid)
    return db.getMerkle(txid)
  })

  res.promise(result)
}

module.exports.send = function (req, res) {
  res.promise(master.sendTx(req.body.rawtx))
}
