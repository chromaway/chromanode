/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var util = require('../util')

module.exports.latest = function (req, res) {
  res.promise(master.getLatestHeader())
}

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      from: util.convertFromToQueryArg(req.query.from, 'from'),
      to: util.convertFromToQueryArg(req.query.to, 'to'),
      count: req.query.count
    }

    if (query.to === undefined && query.count === undefined) {
      query.count = 2016
    }

    return master.headersQuery(query)
  })

  res.promise(result)
}
