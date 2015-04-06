/* globals Promise:true */

var Promise = require('bluebird')

var db = require('../../db').default()
var qutil = require('../util/query')

module.exports.latest = function (req, res) {
  res.promise(db.getLatestHeader())
}

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      count: qutil.transformCount(req.query.count) || 2016
    }

    return db.headersQuery(query)
  })

  res.promise(result)
}
