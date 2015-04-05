/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var qutil = require('../util/query')

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      addresses: qutil.transformAddresses(req.query.addresses),
      source: qutil.transformSource(req.query.source),
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      status: qutil.transformStatus(req.query.status)
    }

    return master.addressesQuery(query)
  })

  res.promise(result)
}
