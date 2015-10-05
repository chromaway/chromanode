import PUtils from 'promise-useful-utils'
import { mixin } from 'core-decorators'
import ReadyMixin from 'ready-mixin'

import config from './config'
import errors from './errors'
import logger from './logger'

let pg = PUtils.promisifyAll(require('pg').native)

let SQL = {
  create: {
    tables: [
      `CREATE TABLE info (
         key CHAR(100) PRIMARY KEY,
         value TEXT NOT NULL)`,
      `CREATE TABLE blocks (
         height INTEGER PRIMARY KEY,
         hash BYTEA NOT NULL,
         header BYTEA NOT NULL,
         txids BYTEA NOT NULL)`,
      `CREATE TABLE transactions (
         txid BYTEA PRIMARY KEY,
         height INTEGER,
         tx BYTEA NOT NULL)`,
      `CREATE TABLE history (
         address BYTEA,
         otxid BYTEA,
         oindex INTEGER,
         ovalue BIGINT,
         oscript BYTEA,
         oheight INTEGER,
         itxid BYTEA,
         iheight INTEGER)`,
      `CREATE TABLE new_txs (
         id SERIAL PRIMARY KEY,
         hex BYTEA NOT NULL)`,
      `CREATE TABLE cc_scanned_txids (
        txid BYTEA PRIMARY KEY,
        blockhash BYTEA,
        height INTEGER)`
    ],
    indices: [
      `CREATE INDEX ON blocks (hash)`,
      `CREATE INDEX ON transactions (height)`,
      `CREATE INDEX ON history (address)`,
      `CREATE INDEX ON history (address, itxid)`,
      `CREATE INDEX ON history (otxid, oindex)`,
      `CREATE INDEX ON history (otxid)`,
      `CREATE INDEX ON history (oheight)`,
      `CREATE INDEX ON history (itxid)`,
      `CREATE INDEX ON history (iheight)`,
      `CREATE INDEX ON cc_scanned_txids (blockhash)`,
      `CREATE INDEX ON cc_scanned_txids (height)`
    ]
  },
  insert: {
    info: {
      row: `INSERT INTO info (key, value) VALUES ($1, $2)`
    }
  },
  select: {
    tablesCount: `SELECT
                    COUNT(*)
                  FROM
                    information_schema.tables
                  WHERE
                    table_name = ANY($1)`,
    info: {
      valueByKey: `SELECT value FROM info WHERE key = $1`
    }
  }
}

/**
 * @class Storage
 */
@mixin(ReadyMixin)
export default class Storage {
  _version = '3'

  /**
   * @constructor
   */
  constructor () {
    this._url = config.get('postgresql.url')

    pg.defaults.poolSize = config.get('postgresql.poolSize', 10)

    this._checkEnv()
      .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Storage ready...') })
  }

  /**
   * @return {Promise}
   */
  _checkEnv (client) {
    return this.executeTransaction(async (client) => {
      let result = await client.queryAsync(SQL.select.tablesCount, [[
        'info',
        'blocks',
        'transactions',
        'history',
        'new_txs',
        'cc_scanned_txids'
      ]])
      let count = parseInt(result.rows[0].count, 10)
      logger.info(`Found ${count} tables`)

      if (count === 0) {
        await this._createEnv(client)
      } else if (count !== 6) {
        throw new errors.Storage.InconsistentTables(count, 6)
      }

      let [version, network] = await* [
        client.queryAsync(SQL.select.info.valueByKey, ['version']),
        client.queryAsync(SQL.select.info.valueByKey, ['network'])
      ]

      // check version
      if (version.rowCount !== 1 ||
          version.rows[0].value !== this._version) {
        throw new errors.Storage.InvalidVersion(
          version.rows[0].value, this._version)
      }

      // check network
      if (network.rowCount !== 1 ||
          network.rows[0].value !== config.get('chromanode.network')) {
        throw new errors.Storage.InvalidNetwork(
          network.rows[0].value, config.get('chromanode.network'))
      }
    })
  }

  /**
   * @param {pg.Client} client
   * @return {Promise}
   */
  async _createEnv (client) {
    logger.info('Creating db tables...')
    await* SQL.create.tables.map((query) => client.queryAsync(query))

    logger.info('Creating db indices...')
    await* SQL.create.indices.map((query) => client.queryAsync(query))

    let version = this._version
    let network = config.get('chromanode.network')

    logger.info('Insert version and network to info...')
    await* [
      client.queryAsync(SQL.insert.info.row, ['version', version]),
      client.queryAsync(SQL.insert.info.row, ['network', network])
    ]
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  async execute (fn) {
    let [client, done] = await pg.connectAsync(this._url)
    try {
      let result = await fn(client)
      done()
      return result
    } catch (err) {
      client.end()
      throw err
    }
  }

  /**
   * @param {string} query
   * @param {Array.<*>} [params]
   * @return {Promise}
   */
  executeQuery (query, params) {
    return this.execute((client) => {
      return client.queryAsync(query, params)
    })
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  executeTransaction (fn) {
    return this.execute(async (client) => {
      await client.queryAsync('BEGIN')
      try {
        var result = await fn(client)
      } catch (err) {
        await client.queryAsync('ROLLBACK')
        throw err
      }

      await client.queryAsync('COMMIT')
      return result
    })
  }
}
