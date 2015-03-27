/* globals Promise:true */
var Promise = require('bluebird')
var pg = Promise.promisifyAll(require('pg').native)

var errors = require('./errors')
var logger = require('./logger').logger

/**
 * @class Storage
 * @param {Object} opts
 * @param {string} opts.url
 * @param {string} opts.network
 */
function Storage (opts) {
  this._version = '1'

  this._url = opts.url
  this._network = opts.network
}

/**
 * @param {function} fn
 * @return {Promise}
 */
Storage.prototype.execute = function (fn) {
  return pg.connectAsync(this._url).spread(function (client, done) {
    return fn(client)
      .then(done, function (err) {
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
      .then(function () {
        return client.queryAsync('COMMIT')

      }, function (err) {
        logger.error('Storage.executeTransaction: %s', err.stack || err)
        return client.queryAsync('ROLLBACK')

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
    '  address BYTEA NOT NULL,' +
    '  txid BYTEA NOT NULL,' +
    '  index INTEGER NOT NULL,' +
    '  value BIGINT,' +
    '  height INTEGER NOT NULL)',
    'CREATE INDEX ON history (address, height)',
    'CREATE INDEX ON history (height)',

    'CREATE TABLE history_mempool (' +
    '  address BYTEA NOT NULL,' +
    '  txid BYTEA NOT NULL,' +
    '  index INTEGER NOT NULL,' +
    '  value BIGINT)',
    'CREATE INDEX ON history_mempool (address)',
    'CREATE INDEX ON history_mempool (txid)'
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

        return Promise.all([
          client.queryAsync(insertToInfo, ['network', self._network]),
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
        if (result.rows[0].value !== self._network) {
          throw new errors.Storage.InvalidNetwork(result.rows[0].value, self._network)
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

/**
 * @return {Promise}
 */
Storage.prototype.getBestBlock = function () {
  return this.execute(function (client) {
    return client.queryAsync('SELECT * FROM blocks ORDER BY height DESC LIMIT 1')
      .then(function (result) { return result.rows[0] })
  })
}

module.exports = Storage
