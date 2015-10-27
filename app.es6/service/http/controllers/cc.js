import _ from 'lodash'
import bitcore from 'bitcore-lib'
import cclib from 'coloredcoinjs-lib'

import errors from '../../../lib/errors'
import SQL from '../../../lib/sql'
import { getTx } from '../util/tx'

let cdata
let init = (_cdefManager, _cdata) => {
  cdata = _cdata
}

let v2 = {}
export default {init, v2}

v2.getAllColoredCoins = (req, res) => {
  res.promise((async () => {
    let {rows} = await req.storage.executeQuery(
      SQL.select.ccData.coinsByDesc, [req.body.color])

    if (rows.length === 0) {
      throw new errors.Service.InvalidColor(req.body.color)
    }

    return {
      coins: rows.map((row) => {
        return {
          txId: row.txid.toString('hex'),
          outIndex: row.oidx,
          height: row.height,
          colorValue: JSON.parse(row.value)
        }
      })
    }
  })())
}

v2.getTxColorValues = (req, res) => {
  res.promise((async () => {
    let outIndices = req.body.outIndices
    if (outIndices === undefined && req.body.outIndex !== undefined) {
      outIndices = [req.body.outIndex]
    }

    if (outIndices === undefined) {
      outIndices = null
    } else {
      outIndices = outIndices.map((v) => parseInt(v, 10))
      if (!_.every(outIndices, _.isFinite)) {
        throw new errors.Service.InvalidOutIndices(JSON.stringify(outIndices))
      }
    }

    let colorKernel = req.body.colorKernel || 'epobc'
    let cdefCls = cclib.definitions.Manager.getColorDefinitionClass(colorKernel)
    if (cdefCls === null) {
      throw new errors.Service.InvalidColorKernel(colorKernel)
    }

    let getTxFn = async (txId) => {
      let rawTx = await getTx(req.storage, txId)
      return new bitcore.Transaction(rawTx)
    }

    let tx = await getTxFn(req.body.txId)
    let result = await cdata.getTxColorValues(tx, outIndices, cdefCls, getTxFn)

    let outColorValues = new Array(tx.outputs.length).fill(null)
    for (let outColorValues2 of result.outputs.values()) {
      for (let [outIndex, colorValue] of outColorValues2.entries()) {
        if (colorValue !== null) {
          // output have multiple colors
          if (outColorValues[outIndex] !== null) {
            throw new errors.Service.MultipleColorsOutIndex(`${colorValue.toString()} and ${outColorValues[outIndex].toString()}`)
          }

          outColorValues[outIndex] = colorValue
        }
      }
    }

    return {
      colorValues: outColorValues.map((cv) => {
        if (cv === null) {
          return null
        }

        return {
          color: cv.getColorDefinition().getDesc(),
          value: cv.getValue()
        }
      })
    }
  })())
}
