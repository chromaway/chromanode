'use strict'

var _ = require('lodash')
var assert = require('assert')
var bitcore = require('bitcore')
var Address = bitcore.Address
var isHexa = bitcore.util.js.isHexa

var config = require('../../../../lib/config')
var errors = require('../../../../lib/errors')
var SQL = require('../../sql')

/**
 * @param {string} name
 * @return {function}
 */
function createTransformFromTo (name) {
  return function (val) {
    if (val === undefined) {
      return val
    }

    var num = parseInt(val, 10)
    if (!_.isNaN(num) && val.length < 7) {
      if (num >= 0 && num < 1e7) {
        return num
      }

      throw new errors.Slave.InvalidHeight()
    }

    if (val.length === 64 && isHexa(val)) {
      return val
    }

    throw new errors.Slave.InvalidHash()
  }
}

/**
 * @param {string} val
 * @return {(string|number)}
 * @throws {errors.Slave}
 */
module.exports.transformFrom = createTransformFromTo('from')

/**
 * @param {string} val
 * @return {(string|number)}
 * @throws {errors.Slave}
 */
module.exports.transformTo = createTransformFromTo('to')

/**
 * @param {string} val
 * @return {number}
 * @throws {errors.Slave.InvalidCount}
 */
module.exports.transformCount = function (val) {
  if (val === undefined) {
    return val
  }

  var num = parseInt(val, 10)
  if (!_.isNaN(num) && num > 0 && num <= 2016) {
    return num
  }

  throw new errors.Slave.InvalidCount()
}

/**
 * @param {string} val
 * @return {string[]}
 * @throws {errors.Slave}
 */
module.exports.transformAddresses = function (val) {
  if (!val || val.indexOf === undefined) {
    throw new errors.Slave.InvalidAddresses()
  }

  var network = bitcore.Networks.get(config.get('chromanode.network'))

  var addresses = val.indexOf(',') !== -1 ? val.split(',') : [val]
  addresses.forEach(function (address) {
    try {
      if (network.name === 'regtest') {
        assert.equal(Address.fromString(address).network.name, 'testnet')
      }
      else {
        assert.equal(Address.fromString(address).network.name, network.name)
      }

    } catch (err) {
      throw new errors.Slave.InvalidAddresses()
    }
  })

  return addresses
}

/**
 * @param {string} val
 * @return {string}
 * @throws {errors.Slave.InvalidSource}
 */
module.exports.transformSource = function (val) {
  if (val !== undefined && ['blocks', 'mempool'].indexOf(val) === -1) {
    throw new errors.Slave.InvalidSource()
  }

  return val
}

/**
 * @param {string} val
 * @return {string}
 * @throws {errors.Slave.InvalidStatus}
 */
module.exports.transformStatus = function (val) {
  if (val !== undefined && ['transactions', 'unspent'].indexOf(val) === -1) {
    throw new errors.Slave.InvalidStatus()
  }

  return val
}

/**
 * @param {string} val
 * @return {string}
 */
module.exports.transformTxId = function (val) {
  if (!!val && val.length === 64 && isHexa(val)) {
    return val
  }

  throw new errors.Slave.InvalidTxId()
}

/**
 * @param {pg.Client} client
 * @param {(string|number)} point hash or height
 * @return {Promise<?number>}
 */
module.exports.getHeightForPoint = function (client, point) {
  var args = _.isNumber(point)
               ? [SQL.select.blocks.heightByHeight, [point]]
               : [SQL.select.blocks.heightByHash, ['\\x' + point]]

  return client.queryAsync.apply(client, args)
    .then(function (result) {
      if (result.rowCount === 0) {
        return null
      }

      return result.rows[0].height
    })
}
