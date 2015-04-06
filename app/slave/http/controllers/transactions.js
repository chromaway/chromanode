/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var qutil = require('../util/query')

module.exports.raw = function (req, res) {
  var result = Promise.try(function () {
    var txid = qutil.transformTxId(req.query.txid)
    return master.getRawTransaction(txid)
  })

  res.promise(result)
}

module.exports.merkle = function (req, res) {
  res.jerror('todo')
}

module.exports.send = function (req, res) {
  res.jerror('todo')
}
