import _ from 'lodash'
import bitcore from 'bitcore'

import errors from '../../../lib/errors'
import util from '../../../lib/util'
import SQL from '../../sql'
import qutil from '../util/query'

export let v1 = {}
export let v2 = {}

v1.raw = v2.raw = (req, res) => {
  res.promise((async () => {
    let txid = '\\x' + qutil.transformTxId(req.query.txid)
    let result = await req.storage.executeQuery(
      SQL.select.transactions.byTxId, [txid])

    if (result.rowCount === 0) {
      throw new errors.Slave.TxNotFound()
    }

    return {hex: result.rows[0].tx.toString('hex')}
  })())
}

v1.merkle = v2.merkle = function (req, res) {
  res.promise((async () => {
    let txid = qutil.transformTxId(req.query.txid)
    let result = await req.storage.executeQuery(
      SQL.select.blocks.txids, ['\\x' + txid])

    if (result.rowCount === 0) {
      throw new errors.Slave.TxNotFound()
    }

    if (result.rows[0].height === null) {
      return {source: 'mempool'}
    }

    let bTxIds = result.rows[0].txids.toString('hex')
    let txids = []
    for (let cnt = bTxIds.length / 64, idx = 0; idx < cnt; idx += 1) {
      txids.push(bTxIds.slice(idx * 64, (idx + 1) * 64))
    }

    let merkle = []
    let hashes = txids.map(util.decode)
    let targetHash = util.decode(txid)
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
        index: txids.indexOf(txid)
      }
    }
  })())
}

v1.send = v2.send = function (req, res) {
  res.promise(req.master.sendTx(req.body.rawtx))
}

v2.spent = function (req, res) {
  res.promise((async () => {
    let otxid = '\\x' + qutil.transformTxId(req.query.otxid)
    let oindex = parseInt(req.query.oindex, 10)
    let result = await req.storage.executeQuery(
      SQL.select.history.spent, [otxid, oindex])

    if (result.rowCount === 0) {
      throw new errors.Slave.TxNotFound()
    }

    if (result.rows[0].itxid === null) {
      return {spent: false}
    }

    return {
      spent: true,
      itxid: result.rows[0].itxid.toString('hex'),
      iheight: result.rows[0].iheight
    }
  })())
}
