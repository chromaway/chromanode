import errors from '../../../lib/errors'
import SQL from '../../../lib/sql'

/**
 * @param {Storage} storage
 * @param {string} txId
 * @return {Promise<Buffer>}
 */
async function getTx (storage, txId) {
  let {rows} = await storage.executeQuery(SQL.select.transactions.byTxId, [`\\x${txId}`])
  if (rows.length === 0) {
    throw new errors.Service.TxNotFound(txId)
  }

  return rows[0].tx
}

export default {getTx: getTx}
