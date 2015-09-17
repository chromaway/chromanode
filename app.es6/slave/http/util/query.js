import _ from 'lodash'
import bitcore from 'bitcore'
import assert from 'assert'

import config from '../../../lib/config'
import errors from '../../../lib/errors'
import SQL from '../../sql'

/**
 * @param {string} val
 * @return {(string|number)}
 */
function transformFromTo (val) {
  if (val === undefined) {
    return val
  }

  let num = parseInt(val, 10)
  if (!_.isNaN(num) && val.length < 7) {
    if (num >= 0 && num < 1e7) {
      return num
    }

    throw new errors.Slave.InvalidHeight()
  }

  if (val.length === 64 && bitcore.util.js.isHexa(val)) {
    return val
  }

  throw new errors.Slave.InvalidHash()
}

/**
 * @param {string} val
 * @return {number}
 * @throws {errors.Slave.InvalidCount}
 */
function transformCount (val) {
  if (val === undefined) {
    return 2016
  }

  let num = parseInt(val, 10)
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
function transformAddresses (val) {
  if (!_.isString(val)) {
    throw new errors.Slave.InvalidAddresses()
  }

  let networkName = config.get('chromanode.network')
  if (networkName === 'regtest') {
    networkName = 'testnet'
  }

  let addresses = val.indexOf(',') !== -1 ? val.split(',') : [val]
  for (let address of addresses) {
    try {
      let addressNetwork = bitcore.Address.fromString(address).network.name
      assert.equal(addressNetwork, networkName)
    } catch (err) {
      throw new errors.Slave.InvalidAddresses()
    }
  }

  return addresses
}

/**
 * @param {string} val
 * @return {string}
 * @throws {errors.Slave.InvalidSource}
 */
function transformSource (val) {
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
function transformStatus (val) {
  if (val !== undefined && ['transactions', 'unspent'].indexOf(val) === -1) {
    throw new errors.Slave.InvalidStatus()
  }

  return val
}

/**
 * @param {string} val
 * @return {string}
 */
function transformTxId (val) {
  if (!!val && val.length === 64 && bitcore.util.js.isHexa(val)) {
    return val
  }

  throw new errors.Slave.InvalidTxId()
}

/**
 * @param {pg.Client} client
 * @param {(string|number)} point hash or height
 * @return {Promise<?number>}
 */
async function getHeightForPoint (client, point) {
  let args = _.isNumber(point)
               ? [SQL.select.blocks.heightByHeight, [point]]
               : [SQL.select.blocks.heightByHash, ['\\x' + point]]

  let result = await client.queryAsync(...args)
  if (result.rowCount === 0) {
    return null
  }

  return result.rows[0].height
}

export default {
  transformFromTo: transformFromTo,
  transformCount: transformCount,
  transformAddresses: transformAddresses,
  transformSource: transformSource,
  transformStatus: transformStatus,
  transformTxId: transformTxId,
  getHeightForPoint: getHeightForPoint
}
