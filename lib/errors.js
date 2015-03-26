var errorSystem = require('error-system')

/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidNetwork
 */

module.exports = errorSystem.extend(Error, {
  name: 'Chromanode',
  message: 'Chromanode internal error',
  errors: [{
    name: 'InvalidNetwork',
    message: 'Invalid network: {0}'
  }]
}).Chromanode
