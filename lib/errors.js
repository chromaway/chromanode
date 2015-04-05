var errorSystem = require('error-system')

/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidBitcoindNetwork
 *       +-- InvalidNetwork
 *       +-- Slave
 *       |    +-- AddressesRequired
 *       |    +-- FromNotFound
 *       |    +-- InvalidAddresses
 *       |    +-- InvalidCount
 *       |    +-- InvalidHash
 *       |    +-- InvalidHeight
 *       |    +-- InvalidRequestedCount
 *       |    +-- InvalidSource
 *       |    +-- InvalidStatus
 *       |    +-- ToNotFound
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
      {name: 'AddressesRequired', message: ''},
      {name: 'FromNotFound', message: ''},
      {name: 'InvalidAddresses', message: ''},
      {name: 'InvalidCount', message: ''},
      {name: 'InvalidHash', message: ''},
      {name: 'InvalidHeight', message: ''},
      {name: 'InvalidRequestedCount', message: ''},
      {name: 'InvalidSource', message: ''},
      {name: 'InvalidStatus', message: ''},
      {name: 'ToNotFound', message: ''}
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
