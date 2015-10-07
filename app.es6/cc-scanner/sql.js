export default {
  insert: {
    unconfirmed: `INSERT INTO cc_scanned_txids
                    (txid)
                  VALUES
                    ($1)`,
    confirmed: `INSERT INTO cc_scanned_txids
                  (txid, blockhash, height)
                VALUES
                  ($1, $2, $3)`
  },
  select: {
    ccLatestBlock: `SELECT
                      blockhash AS blockhash,
                      height AS height
                    FROM
                      cc_scanned_txids
                    WHERE
                      height IS NOT NULL
                    ORDER BY
                      height DESC
                    LIMIT 1`,
    ccBlockHashByHeight: `SELECT
                            blockhash AS blockhash
                          FROM
                            cc_scanned_txids
                          WHERE
                            height = $1
                          LIMIT 1`,
    latestBlock: `SELECT
                    hash AS hash
                  FROM
                    blocks
                  ORDER BY
                    height DESC
                  LIMIT 1`,
    blockByHeight: `SELECT
                      hash AS hash,
                      txids AS txids
                    FROM
                      blocks
                    WHERE
                      height = $1`,
    isBlockExists: `SELECT EXISTS (SELECT
                                     true
                                   FROM
                                     blocks
                                   WHERE
                                     hash = $1)`,
    notAddedBlockHashes: `SELECT
                            hash AS hash
                          FROM
                            blocks
                          WHERE
                            height >= (SELECT
                                         COALESCE(MAX(height), 0)
                                       FROM
                                         cc_scanned_txids)
                          ORDER BY
                            height ASC`,
    ccUnconfirmedTxIds: `SELECT
                           txid AS txid
                         FROM
                           cc_scanned_txids
                         WHERE
                           height IS NULL`,
    unconfirmedTxIds: `SELECT
                         txid AS txid
                       FROM
                         transactions
                       WHERE
                         height IS NULL`,
    rawtx: `SELECT
              tx AS tx
            FROM
              transactions
            WHERE
              txid = $1`,
    isTxScanned: `SELECT EXISTS (SELECT
                                   true
                                 FROM
                                   cc_scanned_txids
                                 WHERE
                                   txid = $1)`,
    colorId: `SELECT
                id AS id
              FROM
                cclib_definitions
              WHERE
                cdesc ~ $1`
  },
  update: {
    makeUnconfirmed: `UPDATE
                        cc_scanned_txids
                      SET
                        blockhash = NULL,
                        height = NULL
                      WHERE
                        height > $1`,
    makeConfirmed: `UPDATE
                      cc_scanned_txids
                    SET
                      blockhash = $2,
                      height = $3
                    WHERE
                      txid = ANY($1)`
  },
  delete: {
    row: `DELETE FROM cc_scanned_txids WHERE txid = $1`
  }
}
