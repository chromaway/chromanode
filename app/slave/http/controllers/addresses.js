/* globals Promise:true */

var Promise = require('bluebird')

var qutil = require('../util/query')

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      addresses: qutil.transformAddresses(unescape(req.query.addresses)),
      source: qutil.transformSource(req.query.source),
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      status: qutil.transformStatus(req.query.status)
    }

    return db.addressesQuery(query)
  })

  res.promise(result)
}
