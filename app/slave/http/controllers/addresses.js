/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var util = require('../util')

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      addresses: util.exctractAddresses(req.query.addresses),
      source: util.checkSource(req.query.source),
      from: util.convertFromToQueryArg(req.query.from),
      to: util.convertFromToQueryArg(req.query.to),
      status: util.checkStatus(req.query.status)
    }

    return master.addressesQuery(query)
  })

  res.promise(result)
}
