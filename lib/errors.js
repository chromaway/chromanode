var errorSystem = require('error-system')

/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidNetwork
 *       +-- Slave
 *       |    +-- InvalidArguments
 *       +-- Storage
 *            +-- InconsistentTables
 *            +-- InvalidNetwork
 *            +-- InvalidVersion
 */

module.exports = errorSystem.extend(Error, {
  name: 'Chromanode',
  message: 'Chromanode internal error',
  errors: [{
    name: 'InvalidNetwork',
    message: 'Invalid network: {0}'
  }, {
    name: 'Slave',
    message: 'Slave internal error',
    errors: [{
      name: 'InvalidArguments',
      message: '{0}'
    }]
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
