/* globals Promise:true */

var _ = require('lodash')
var timers = require('timers')
var Promise = require('bluebird')

var config = require('../../lib/config')
var logger = require('../../lib/logger').logger
var Storage = require('../../lib/storage')
var util = require('../../lib/util')
var Network = require('./network')
var Slaves = require('./slaves')
var HistorySync = require('./sync/history')
var PeerSync = require('./sync/peer')
var sql = require('./sql')

/**
 * @class Master
 */
function Master () {
  var self = this

  self.status = {
    version: util.getVersion(),
    network: config.get('chromanode.network'),
    progress: null,
    latest: {
      hash: null,
      height: null
    },
    bitcoind: {
      version: null,
      protocolversion: null,
      connections: 0,
      errors: null,
      latest: {
        hash: null,
        height: null
      }
    }
  }

  self.broadcastStatus = function () {}
}

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  self.storage = new Storage()
  self.network = new Network()
  self.slaves = new Slaves(self.storage)
  self.historySync = new HistorySync(self.storage, self.network, self.slaves)
  self.peerSync = new PeerSync(self.storage, self.network, self.slaves)

  return Promise.all([
    self.storage.init(),
    self.network.init()
  ])
  .then(function () {
    return Promise.all([
      self.slaves.init()
    ])
  })
  .then(function () {
    return Promise.all([
      self._installSendTxHandler(),
      self._installBitcoindHandlers()
    ])
  })
  .then(function () {
    self.broadcastStatus = _.debounce(function () {
      self.slaves.broadcastStatus(self.status)
    }, 500)

    // run historySync
    timers.setImmediate(function () { self._runHistorySync() })
  })
}

/**
 */
Master.prototype._installSendTxHandler = function () {
  var self = this
  self.slaves.on('sendTx', function (id) {
    self.storage.execute(function (client) {
      client.queryAsync(sql.select.new_txs.byId, [id]).then(function (result) {
        client.queryAsync(sql.delete.new_txs.byId, [id])
        self.network.sendTx(result.rows[0].hex)
          .then(function () { return null })
          .catch(function (err) {
            if (err instanceof Error) {
                return {code: null, message: err.message}
            }
            return err
          })
          .then(function (ret) {
            self.slaves.sendTxResponse(id, ret)
          })
        })
      })
    })
}

/**
 * @return {Promise}
 */
Master.prototype._installBitcoindHandlers = function () {
  var self = this

  var updateBitcoindInfo = function (info) {
    return self.network.getBitcoindInfo()
      .then(function (info) {
        var old = self.status.bitcoind
        var shouldBroadcast = old.version !== info.version ||
                              old.protocolversion !== info.protocolversion ||
                              old.connections !== info.connections ||
                              old.errors !== info.errors

        if (shouldBroadcast) {
          self.status.bitcoind.version = info.version
          self.status.bitcoind.protocolversion = info.protocolversion
          self.status.connections = info.connections
          self.status.errors = info.errors
          self.broadcastStatus()
        }
      })
      .finally(function () {
        setTimeout(updateBitcoindInfo, 5000)
      })
  }

  var onNewBlock = util.makeConcurrent(function () {
    return self.network.getLatest()
      .then(function (latest) {
        if (self.status.bitcoind.latest.hash !== latest.hash) {
          self.status.bitcoind.latest = latest
          self.broadcastStatus()
        }
      })
  }, {concurrency: 1})
  self.network.on('block', onNewBlock)

  return Promise.all([
    updateBitcoindInfo(),
    onNewBlock()
  ])
}

/**
 */
Master.prototype._runHistorySync = function () {
  var self = this

  logger.info('Run HistorySync...')

  function onLatest (latest) {
    self.status.latest = latest

    var value = latest.height / self.status.bitcoind.latest.height
    var fixedValue = value.toFixed(4)
    if (self.status.progress !== fixedValue) {
      logger.info('Sync progress: %s (%d of %d)',
                  value.toFixed(6),
                  latest.height, self.status.bitcoind.latest.height)
      self.status.progress = fixedValue
      self.broadcastStatus()
    }
  }

  Promise.try(function () {
    self.historySync.on('latest', onLatest)
    return self.historySync.run()
  })
  .finally(function () {
    self.historySync.removeListener('latest', onLatest)
  })
  .catch(function (err) {
    setTimeout(self._runHistorySync.bind(self), 30 * 1000)
    throw err
  })
  .then(function () {
    logger.info('HistorySync finished!')

    // run PeerSync
    timers.setImmediate(self._runPeerSync.bind(self))
  })
}

/**
 */
Master.prototype._runPeerSync = function () {
  var self = this

  logger.info('Run PeerSync...')

  self.peerSync.on('latest', function (latest) {
    self.status.latest = latest
    self.broadcastStatus()
  })

  self.peerSync.run()
    .catch(function (err) {
      logger.error('Error on calling PeerSync.run()! Please restart...')
      throw err
    })
}

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var master = new Master()
  return master.init()
}
