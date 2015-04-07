var messages = require('../../lib/messages').default()

/**
 * @class Slaves
 */
function Slaves () {}

/**
 * @param {pg.Client} client
 * @param {string} blockid
 * @param {number} height
 * @return {Promise}
 */
Slaves.prototype.newBlock = function (client, blockid, height) {
  var payload = JSON.stringify({blockid: blockid, height: height})
  return messages.notify(client, 'newblock', payload)
}

/**
 * @param {pg.Client} client
 * @param {string} address
 * @param {string} txid
 * @return {Promise}
 */
Slaves.prototype.addressTouched = function (client, address, txid) {
  var payload = JSON.stringify({address: address, txid: txid})
  return messages.notify(client, 'addresstouched', payload)
}

module.exports = require('soop')(Slaves)
