module.exports.status = function (req, res) {
  res.jsend({bitcoind: {}, chromanode: {}})
}
