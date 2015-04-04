var assert = require('assert')
var bitcore = require('bitcore')
var Address = bitcore.Address
var isHexa = bitcore.util.js.isHexa

var config = require('../../../lib/config')
var errors = require('../../../lib/errors')

/**
 * @param {string} val
 * @param {string} name
 * @return {(string|number})
 * @throws {errors.Slave.InvalidArguments}
 */
module.exports.convertFromToQueryArg = function (val, name) {
  if (!(val === undefined || (val.length === 64 && isHexa(val)))) {
    val = parseInt(val, 10)
    if (isNaN(val)) {
      throw new errors.Slave.InvalidArguments(name + ' not number')
    }
  }

  return val
}

/**
 * @param {string} val
 * @return {string[]}
 * @throws {errors.Slave.InvalidArguments}
 */
module.exports.exctractAddresses = function (val) {
  if (val === undefined) {
    throw new errors.Slave.InvalidArguments('addresses is required param')
  }

  var network = bitcore.Networks.get(config.get('chromanode.network'))

  var addresses = val.indexOf(',') === -1 ? val.split(',') : [val]
  addresses.forEach(function (address) {
    try {
      assert.equal(Address.fromString(address).network.name, network.name)

    } catch (err) {
      throw new errors.Slave.InvalidArguments('invalid address ' + address)
    }
  })

  return addresses
}

/**
 * @param {string} val
 * @return {string}
 * @throws {errors.Slave.InvalidArguments}
 */
module.exports.checkSource = function (val) {
  if (val !== undefined && ['blocks', 'mempool'].indexOf(val) === -1) {
    throw new errors.Slave.InvalidArguments('invalid source ' + val)
  }

  return val
}

/**
 * @param {string} val
 * @return {string}
 * @throws {errors.Slave.InvalidArguments}
 */
module.exports.checkStatus = function (val) {
  if (val !== undefined && ['unspent'].indexOf(val) === -1) {
    throw new errors.Slave.InvalidArguments('invalid status ' + val)
  }

  return val
}
