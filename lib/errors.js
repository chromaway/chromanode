var errorSystem = require('error-system')

/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidBitcoindNetwork
 *       +-- InvalidNetwork
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

module.exports = errorSystem.extend(Error, {
  name: 'Chromanode',
  message: 'Chromanode internal error',
  errors: [{
    name: 'InvalidBitcoindNetwork',
    message: 'Bitcoind have other network!'
  }, {
    name: 'InvalidNetwork',
    message: 'Invalid network: {0}'
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
      message: 'Storage have inconsistent tables'
    }, {
      name: 'InvalidNetwork',
      message: 'Storage have other network: {0} (expected {1})'
    }, {
      name: 'InvalidVersion',
      message: 'Storage have other version: {0} (expected {1})'
    }]
  }]
}).Chromanode
