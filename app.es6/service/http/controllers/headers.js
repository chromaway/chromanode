import _ from 'lodash'

import errors from '../../../lib/errors'
import SQL from '../../../lib/sql'
import qutil from '../util/query'

let v1 = {}
let v2 = {}
export default {v1, v2}

async function getLatest (req) {
  let latest = (await req.storage.executeQuery(SQL.select.blocks.latest)).rows[0]

  return {
    height: latest.height,
    hash: latest.hash.toString('hex'),
    header: latest.header.toString('hex')
  }
}

v1.latest = (req, res) => {
  res.promise((async () => {
    let latest = await getLatest(req)
    return {
      height: latest.height,
      blockid: latest.hash,
      header: latest.header
    }
  })())
}

v2.latest = (req, res) => {
  res.promise(getLatest(req))
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
        throw new errors.Service.FromNotFound(query.from)
      }
    }

    let to = from + query.count
    if (query.to !== undefined) {
      to = await qutil.getHeightForPoint(client, query.to)
      if (to === null) {
        throw new errors.Service.ToNotFound(query.to)
      }
    }

    let count = to - from
    if (count <= 0 || count > 2016) {
      throw new errors.Service.InvalidRequestedCount(count)
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

v1.query = (req, res) => query(req, res, -1)
v2.query = (req, res) => query(req, res, 0)
