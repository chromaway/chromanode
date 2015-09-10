import _ from 'lodash'

import errors from '../../../lib/errors'
import SQL from '../../sql'
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
        throw new errors.Slave.FromNotFound()
      }
    }

    let to = latest.height
    if (query.to !== undefined) {
      to = await qutil.getHeightForPoint(client, query.to)
      if (to === null) {
        throw new errors.Slave.ToNotFound()
      }
    }

    let sql = query.status === 'unspent'
                ? SQL.select.history.unspent
                : SQL.select.history.transactions
    result = await client.queryAsync(sql, [query.addresses, from, to])

    let rows = _.chain(result.rows)
    if (query.status === 'unspent') {
      rows = rows.map((row) => {
        return {
          txid: row.otxid.toString('hex'),
          vout: row.oindex,
          value: row.ovalue,
          script: row.oscript.toString('hex'),
          height: row.oheight
        }
      })
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
        .unique()
    }

    let value = rows
      .filter((row) => {
        if ((row.height !== null) &&
            (row.height > from && row.height <= to)) {
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
