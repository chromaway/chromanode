var util = require('../../../../lib/util')

module.exports.version = function (req, res) {
  res.jsend({version: util.getVersion()})
}

module.exports.status = function (req, res) {
  res.promise(req.master.getStatus())
}
