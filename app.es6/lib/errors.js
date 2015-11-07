/**
 * Error
 *  +-- Chromanode
 *       +-- InvalidBitcoindNetwork
 *       +-- InvalidNetwork
 *       +-- Service
 *       |    +-- FromNotFound
 *       |    +-- InvalidAddresses
 *       |    +-- InvalidColor
 *       |    +-- InvalidColorKernel
 *       |    +-- InvalidCount
 *       |    +-- InvalidHash
 *       |    +-- InvalidHeight
 *       |    +-- InvalidOutIndices
 *       |    +-- InvalidRequestedCount
 *       |    +-- InvalidTxId
 *       |    +-- InvalidSource
 *       |    +-- InvalidStatus
 *       |    +-- MultipleColors
 *       |    +-- MultipleColorsOutIndex
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
    name: 'Service',
    message: 'Service internal error',
    errors: [
      {name: 'FromNotFound', message: '{0}'},
      {name: 'InvalidAddresses', message: '{0}'},
      {name: 'InvalidColor', message: '{0}'},
      {name: 'InvalidColorKernel', message: '{0}'},
      {name: 'InvalidCount', message: '{0}'},
      {name: 'InvalidHash', message: '{0}'},
      {name: 'InvalidHeight', message: '{0}'},
      {name: 'InvalidOutIndices', message: '{0}'},
      {name: 'InvalidRequestedCount', message: '{0}'},
      {name: 'InvalidTxId', message: '{0}'},
      {name: 'InvalidSource', message: '{0}'},
      {name: 'InvalidStatus', message: '{0}'},
      {name: 'MultipleColors', message: '{0}'},
      {name: 'SendTxError', message: '{0}'},
      {name: 'ToNotFound', message: '{0}'},
      {name: 'TxNotFound', message: '{0}'}
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
