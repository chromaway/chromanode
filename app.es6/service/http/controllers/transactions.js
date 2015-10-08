import _ from 'lodash'
import bitcore from 'bitcore'

import errors from '../../../lib/errors'
import util from '../../../lib/util'
import SQL from '../../../lib/sql'
import qutil from '../util/query'

let v1 = {}
let v2 = {}
export default {v1, v2}

v1.raw = v2.raw = (req, res) => {
  res.promise((async () => {
    let txId = `\\x${qutil.transformTxId(req.query.txid)}`
    let result = await req.storage.executeQuery(
      SQL.select.transactions.byTxId, [txId])

    if (result.rowCount === 0) {
      throw new errors.Service.TxNotFound()
    }

    return {hex: result.rows[0].tx.toString('hex')}
  })())
}

v1.merkle = v2.merkle = function (req, res) {
  res.promise((async () => {
    let txId = qutil.transformTxId(req.query.txid)
    let result = await req.storage.executeQuery(
      SQL.select.blocks.txIdsByTxId, [`\\x${txId}`])

    if (result.rowCount === 0) {
      throw new errors.Service.TxNotFound()
    }

    if (result.rows[0].height === null) {
      return {source: 'mempool'}
    }

    let bTxIds = result.rows[0].txids.toString('hex')
    let txIds = []
    for (let cnt = bTxIds.length / 64, idx = 0; idx < cnt; idx += 1) {
      txIds.push(bTxIds.slice(idx * 64, (idx + 1) * 64))
    }

    let merkle = []
    let hashes = txIds.map(util.decode)
    let targetHash = util.decode(txId)
    while (hashes.length !== 1) {
      if (hashes.length % 2 === 1) {
        hashes.push(_.last(hashes))
      }

      let nHashes = []
      for (let cnt = hashes.length, idx = 0; idx < cnt; idx += 2) {
        let nHashSrc = Buffer.concat([hashes[idx], hashes[idx + 1]])
        let nHash = bitcore.crypto.Hash.sha256sha256(nHashSrc)
        nHashes.push(nHash)

        if (hashes[idx].equals(targetHash)) {
          merkle.push(util.encode(hashes[idx + 1]))
          targetHash = nHash
        } else if (hashes[idx + 1].equals(targetHash)) {
          merkle.push(util.encode(hashes[idx]))
          targetHash = nHash
        }
      }
      hashes = nHashes
    }

    return {
      source: 'blocks',
      block: {
        height: result.rows[0].height,
        hash: result.rows[0].hash.toString('hex'),
        merkle: merkle,
        index: txIds.indexOf(txId)
      }
    }
  })())
}

v2.spent = function (req, res) {
  res.promise((async () => {
    let oTxId = `\\x${qutil.transformTxId(req.query.txid)}`
    let oindex = parseInt(req.query.vout, 10)
    let result = await req.storage.executeQuery(
      SQL.select.history.spent, [oTxId, oindex])

    if (result.rowCount === 0) {
      throw new errors.Service.TxNotFound()
    }

    if (result.rows[0].itxid === null) {
      return {spent: false}
    }

    return {
      spent: true,
      txid: result.rows[0].itxid.toString('hex'),
      height: result.rows[0].iheight
    }
  })())
}

v1.send = v2.send = function (req, res) {
  res.promise(req.scanner.sendTx(req.body.rawtx))
}
