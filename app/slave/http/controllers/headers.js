/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var qutil = require('../util/query')

module.exports.latest = function (req, res) {
  res.promise(master.getLatestHeader())
}

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      count: qutil.transformCount(req.query.count) || 2016
    }

    return master.headersQuery(query)
  })

  res.promise(result)
}
