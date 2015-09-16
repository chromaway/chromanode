/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidBitcoindNetwork
 *       +-- InvalidNetwork
 *       +-- Master
 *       |    +-- InvalidHashPrevBlock
 *       +-- Slave
 *       |    +-- FromNotFound
 *       |    +-- InvalidAddresses
 *       |    +-- InvalidCount
 *       |    +-- InvalidHash
 *       |    +-- InvalidHeight
 *       |    +-- InvalidRequestedCount
 *       |    +-- InvalidTxId
 *       |    +-- InvalidSource
 *       |    +-- InvalidStatus
 *       |    +-- SendTxError
 *       |    +-- ToNotFound
 *       |    +-- TxNotFound
 *       +-- Storage
 *            +-- InconsistentTables
 *            +-- InvalidNetwork
 *            +-- InvalidVersion
 */

let spec = {
  name: 'Chromanode',
  message: 'Chromanode internal error',
  errors: [{
    name: 'InvalidBitcoindNetwork',
    message: 'Bitcoind have other network! Got {0} expected {1}'
  }, {
    name: 'InvalidNetwork',
    message: 'Invalid network: {0}'
  }, {
    name: 'Master',
    message: 'Master intertal error',
    errors: [{
      name: 'InvalidHashPrevBlock',
      message: 'Latest hash: {0}, imported: {1}'
    }]
  }, {
    name: 'Slave',
    message: 'Slave internal error',
    errors: [
      {name: 'FromNotFound', message: ''},
      {name: 'InvalidAddresses', message: ''},
      {name: 'InvalidCount', message: ''},
      {name: 'InvalidHash', message: ''},
      {name: 'InvalidHeight', message: ''},
      {name: 'InvalidRequestedCount', message: ''},
      {name: 'InvalidTxId', message: ''},
      {name: 'InvalidSource', message: ''},
      {name: 'InvalidStatus', message: ''},
      {name: 'SendTxError', message: ''},
      {name: 'ToNotFound', message: ''},
      {name: 'TxNotFound', message: ''}
    ]
  }, {
    name: 'Storage',
    message: 'Storage interval error',
    errors: [{
      name: 'InconsistentTables',
      message: 'Storage have inconsistent tables (found only {0} of {1})'
    }, {
      name: 'InvalidNetwork',
      message: 'Storage have other network: {0} (expected {1})'
    }, {
      name: 'InvalidVersion',
      message: 'Storage have other version: {0} (expected {1})'
    }]
  }]
}

require('error-system').extend(Error, spec)
module.exports = Error.Chromanode
