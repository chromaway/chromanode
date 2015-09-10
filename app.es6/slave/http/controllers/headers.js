import _ from 'lodash'

import errors from '../../../lib/errors'
import SQL from '../../sql'
import qutil from '../util/query'

let v1 = {}
let v2 = {}
export default {v1, v2}

async function latest (req) {
  let result = await req.storage.executeQuery(SQL.select.blocks.latest)
  let row = result.rows[0]

  return {
    height: row.height,
    hash: row.hash.toString('hex'),
    header: row.header.toString('hex')
  }
}

v1.latest = (req, res) => {
  res.promise((async () => {
    let latest = await latest(req)
    return {
      height: latest.height,
      blockid: latest.hash,
      header: latest.header
    }
  })())
}

v2.latest = (req, res) => {
  res.promise(latest(req))
}

function query (req, res, shift) {
  res.promise(req.storage.executeTransaction(async (client) => {
    let query = {
      from: qutil.transformFromTo(req.query.from),
      to: qutil.transformFromTo(req.query.to),
      count: qutil.transformCount(req.query.count)
    }

    let from = -1
    if (query.from !== undefined) {
      from = await qutil.getHeightForPoint(client, query.from)
      if (from === null) {
        throw new errors.Slave.FromNotFound()
      }
    }

    let to = from + query.count
    if (query.to !== undefined) {
      to = await qutil.getHeightForPoint(client, query.to)
      if (to === null) {
        throw new errors.Slave.ToNotFound()
      }
    }

    let count = to - from
    if (count <= 0 || count > 2016) {
      throw new errors.Slave.InvalidRequestedCount()
    }

    let {rows} = await client.queryAsync(
      SQL.select.blocks.headers, [from + shift, to + shift])
    let headers = _.chain(rows)
      .pluck('header')
      .invoke('toString', 'hex')
      .join('')
      .value()

    return {from: from, count: headers.length / 160, headers: headers}
  }))
}

v1.query = _.partialRight(query, -1) // req, res, -1
v2.query = _.partialRight(query, 0)  // req, res, 0
