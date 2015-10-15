import _ from 'lodash'

import errors from '../../../lib/errors'
import SQL from '../../../lib/sql'
import qutil from '../util/query'

let v1 = {}
let v2 = {}
export default {v1, v2}

function query (req) {
  return req.storage.executeTransaction(async (client) => {
    let query = {
      addresses: qutil.transformAddresses(unescape(req.query.addresses)),
      source: qutil.transformSource(req.query.source),
      from: qutil.transformFromTo(req.query.from),
      to: qutil.transformFromTo(req.query.to),
      status: qutil.transformStatus(req.query.status)
    }

    let result = await client.queryAsync(SQL.select.blocks.latest)
    let latest = {
      height: result.rows[0].height,
      hash: result.rows[0].hash.toString('hex')
    }

    let from = -1
    if (query.from !== undefined) {
      from = await qutil.getHeightForPoint(client, query.from)
      if (from === null) {
        throw new errors.Service.FromNotFound(query.from)
      }
    }

    let to = latest.height
    if (query.to !== undefined) {
      to = await qutil.getHeightForPoint(client, query.to)
      if (to === null) {
        throw new errors.Service.ToNotFound(query.to)
      }
    }

    let sql = query.status === 'unspent'
                ? SQL.select.history.unspentToLatest
                : SQL.select.history.transactionsToLatest
    let params = [query.addresses, from]
    if (to !== latest.height) {
      sql = query.status === 'unspent'
              ? SQL.select.history.unspent
              : SQL.select.history.transactions
      params.push(to)
    }

    let rows = _.chain((await client.queryAsync(sql, params)).rows)
    if (query.status === 'unspent') {
      rows = rows.map((row) => {
        return {
          txid: row.otxid.toString('hex'),
          vount: row.oindex,
          value: parseInt(row.ovalue, 10),
          script: row.oscript.toString('hex'),
          height: row.oheight
        }
      })
      .unique((row) => `${row.txid}:${row.vount}`)
    } else {
      rows = rows
        .map((row) => {
          let items = [{
            txid: row.otxid.toString('hex'),
            height: row.oheight
          }]

          if (row.itxid !== null) {
            items.push({
              txid: row.itxid.toString('hex'),
              height: row.iheight
            })
          }

          return items
        })
        .flatten()
        .unique('txid')
    }

    let value = rows
      .filter((row) => {
        if ((row.height !== null) &&
            !(row.height > from && row.height <= to)) {
          return false
        }

        if (query.source === 'blocks' && row.height === null) {
          return false
        }

        if (query.source === 'mempool' && row.height !== null) {
          return false
        }

        return true
      })
      .sortBy('height')
      .value()

    return query.status === 'unspent'
             ? {unspent: value, latest}
             : {transactions: value, latest}
  })
}

v1.query = (req, res) => {
  res.promise((async () => {
    let result = await query(req)
    if (result.transactions === undefined) {
      result.transactions = result.unspent.map((item) => {
        return {txid: item.txid, height: item.height}
      })
      // we call it v1+
      // delete result.unspent
    }

    return result
  })())
}

v2.query = (req, res) => {
  res.promise(query(req))
}
