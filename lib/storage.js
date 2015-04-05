/* globals Promise:true */
var Promise = require('bluebird')
var pg = Promise.promisifyAll(require('pg').native)

var config = require('./config')
var errors = require('./errors')
var logger = require('./logger').logger

/**
 * @class Storage
 */
function Storage () {
  this._version = '2'
  pg.defaults.poolSize = config.get('postgresql.poolSize') || 10
}

/**
 * @param {function} fn
 * @return {Promise}
 */
Storage.prototype.execute = function (fn) {
  var url = config.get('postgresql.url')
  return pg.connectAsync(url).spread(function (client, done) {
    return fn(client)
      .then(function (ret) {
        done()
        return ret

      }, function (err) {
        client.end()
        throw err

      })
  })
}

/**
 * @param {function} fn
 * @return {Promise}
 */
Storage.prototype.executeTransaction = function (fn) {
  return this.execute(function (client) {
    return client.queryAsync('BEGIN')
      .then(function () { return fn(client) })
      .then(function (ret) {
        return client.queryAsync('COMMIT').then(function () { return ret })

      }, function (err) {
        return client.queryAsync('ROLLBACK').then(function () { throw err })

      })
  })
}

/**
 * @param {pg.Client} client
 * @return {Promise}
 */
Storage.prototype._createTables = function (client) {
  var queries = [
    'CREATE TABLE info (' +
    '  key CHAR(100) PRIMARY KEY,' +
    '  value TEXT NOT NULL)',

    'CREATE TABLE blocks (' +
    '  height INTEGER PRIMARY KEY,' +
    '  blockid BYTEA NOT NULL,' +
    '  header BYTEA NOT NULL,' +
    '  txids BYTEA NOT NULL)',
    'CREATE INDEX ON blocks (blockid)',

    'CREATE TABLE transactions (' +
    '  txid BYTEA NOT NULL,' +
    '  height INTEGER NOT NULL,' +
    '  tx BYTEA NOT NULL)',
    'CREATE INDEX ON transactions (txid)',
    'CREATE INDEX ON transactions (height)',

    'CREATE TABLE transactions_mempool (' +
    '  txid BYTEA PRIMARY KEY,' +
    '  tx BYTEA NOT NULL)',

    'CREATE TABLE history (' +
    '  address CHAR(35) NOT NULL,' +
    '  txid BYTEA NOT NULL,' +
    '  index INTEGER NOT NULL,' +
    '  prevtxid BYTEA,' +
    '  outputindex INTEGER,' +
    '  value BIGINT,' +
    '  height INTEGER NOT NULL)',
    'CREATE INDEX ON history (address, height)',
    'CREATE INDEX ON history (height)',
    'CREATE INDEX ON history (txid, index)',

    'CREATE TABLE history_mempool (' +
    '  address BYTEA NOT NULL,' +
    '  txid BYTEA NOT NULL,' +
    '  index INTEGER NOT NULL,' +
    '  prevtxid BYTEA,' +
    '  outputindex INTEGER,' +
    '  value BIGINT)',
    'CREATE INDEX ON history_mempool (address)',
    'CREATE INDEX ON history_mempool (txid)',
    'CREATE INDEX ON history_mempool (txid, index)'
  ]

  var self = this
  return self.executeTransaction(function (client) {
    logger.info('Creating tables...')

    var promise = queries.reduce(function (promise, query) {
      return promise.then(function () { return client.queryAsync(query) })
    }, Promise.resolve())

    return promise
      .then(function () {
        var insertToInfo = 'INSERT INTO info (key, value) VALUES ($1, $2)'
        var network = config.get('chromanode.network')

        return Promise.all([
          client.queryAsync(insertToInfo, ['network', network]),
          client.queryAsync(insertToInfo, ['version', self._version])
        ])
      })
  })
}

/**
 * @return {Promise}
 */
Storage.prototype.init = function () {
  var selectTablesCount = 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ANY($1)'
  var tableNames = [
    'info',
    'blocks',
    'transactions', 'transactions_mempool',
    'history', 'history_mempool'
  ]

  var selectFromInfo = 'SELECT value FROM info WHERE key = $1'

  var self = this
  return self.execute(function (client) {
    return client.queryAsync(selectTablesCount, [tableNames])
      .then(function (result) {
        var cnt = parseInt(result.rows[0].count, 10)

        if (cnt > 0 && cnt !== 6) {
          throw new errors.Storage.InconsistentTables()
        }

        if (cnt === 0) {
          return self._createTables(client)
        }
      })
      .then(function () {
        // check network
        return client.queryAsync(selectFromInfo, ['network'])
      })
      .then(function (result) {
        var network = config.get('chromanode.network')
        if (result.rows[0].value !== network) {
          throw new errors.Storage.InvalidNetwork(result.rows[0].value, network)
        }

        // check version
        return client.queryAsync(selectFromInfo, ['version'])
      })
      .then(function (result) {
        if (result.rows[0].value !== self._version) {
          throw new errors.Storage.InvalidVersion(result.rows[0].value, self._version)
        }

        logger.info('Storage ready...')
      })
  })
}

module.exports = require('soop')(Storage)
