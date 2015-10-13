export default {
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
         tx BYTEA NOT NULL)`,
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
    },
    blocks: {
      row: `INSERT INTO blocks
              (height, hash, header, txids)
            VALUES
              ($1, $2, $3, $4)`
    },
    transactions: {
      confirmed: `INSERT INTO transactions
                    (txid, height, tx)
                  VALUES
                    ($1, $2, $3)`,
      unconfirmed: `INSERT INTO transactions
                      (txid, tx)
                    VALUES
                      ($1, $2)`
    },
    history: {
      confirmedOutput: `INSERT INTO history
                          (address, otxid, oindex, ovalue, oscript, oheight)
                        VALUES
                          ($1, $2, $3, $4, $5, $6)`,
      unconfirmedOutput: `INSERT INTO history
                            (address, otxid, oindex, ovalue, oscript)
                          VALUES
                            ($1, $2, $3, $4, $5)`
    },
    newTx: {
      row: `INSERT INTO new_txs (tx) VALUES ($1) RETURNING id`
    },
    ccScannedTxIds: {
      unconfirmed: `INSERT INTO cc_scanned_txids
                      (txid)
                    VALUES
                      ($1)`,
      confirmed: `INSERT INTO cc_scanned_txids
                    (txid, blockhash, height)
                  VALUES
                    ($1, $2, $3)`
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
      value: `SELECT value FROM info WHERE key = $1`
    },
    blocks: {
      latest: `SELECT
                 height AS height,
                 hash AS hash,
                 header AS header
               FROM
                 blocks
               ORDER BY
                 height DESC
               LIMIT 1`,
      byHeight: `SELECT
                   height AS height,
                   hash AS hash
                 FROM
                   blocks
                 WHERE
                   height = $1`,
      fromHeight: `SELECT
                     hash AS hash
                   FROM
                     blocks
                   WHERE
                     height >= $1`,
      txIdsByHeight: `SELECT
                        height AS height,
                        hash AS hash,
                        header AS header,
                        txids AS txids
                      FROM
                        blocks
                      WHERE
                        height = $1`,
      txIdsByTxId: `SELECT
                      blocks.height AS height,
                      hash AS hash,
                      txids AS txids,
                      txid AS txid
                    FROM
                      blocks
                    RIGHT OUTER JOIN
                      transactions ON transactions.height = blocks.height
                    WHERE
                      txid = $1`,
      heightByHash: `SELECT
                       height AS height
                     FROM
                       blocks
                     WHERE
                       hash = $1`,
      heightByHeight: `SELECT
                         height AS height
                       FROM
                         blocks
                       WHERE
                         height = $1`,
      headers: `SELECT
                  header AS header
                FROM
                  blocks
                WHERE
                  height > $1 AND
                  height <= $2
                ORDER BY
                  height ASC`,
      exists: `SELECT EXISTS (SELECT
                                true
                              FROM
                                blocks
                              WHERE
                                hash = $1)`
    },
    transactions: {
      byTxId: `SELECT
                 tx AS tx
               FROM
                 transactions
               WHERE
                 txid = $1`,
      byTxIds: `SELECT
                  tx AS tx
                FROM
                  transactions
                WHERE
                  txid = ANY($1)`,
      exists: `SELECT EXISTS (SELECT
                                true
                              FROM
                                transactions
                              WHERE
                                txid = $1)`,
      existsMany: `SELECT
                     txid AS txid
                   FROM
                     transactions
                   WHERE
                     txid = ANY($1)`,
      unconfirmed: `SELECT
                      txid AS txid
                    FROM
                      transactions
                    WHERE
                      height IS NULL`
    },
    history: {
      transactions: `SELECT
                       otxid AS otxid,
                       oheight AS oheight,
                       itxid AS itxid,
                       iheight AS iheight
                     FROM
                       history
                     WHERE
                       address = ANY($1) AND
                       (((oheight > $2 OR iheight > $2) AND (oheight <= $3 OR iheight <= $3)) OR
                        oheight IS NULL OR
                        (iheight IS NULL AND itxid IS NOT NULL))`,
      transactionsToLatest: `SELECT
                               otxid AS otxid,
                               oheight AS oheight,
                               itxid AS itxid,
                               iheight AS iheight
                             FROM
                               history
                             WHERE
                               address = ANY($1) AND
                               (oheight > $2 OR
                                iheight > $2 OR
                                oheight IS NULL OR
                                (iheight IS NULL AND itxid IS NOT NULL))`,
      unspent: `SELECT
                  otxid AS otxid,
                  oindex AS oindex,
                  ovalue AS ovalue,
                  oscript AS oscript,
                  oheight AS oheight
                FROM
                  history
                WHERE
                  address = ANY($1) AND
                  itxid IS NULL AND
                  (((oheight > $2 OR iheight > $2) AND (oheight <= $3 OR iheight <= $3)) OR
                   oheight IS NULL)`,
      unspentToLatest: `SELECT
                          otxid AS otxid,
                          oindex AS oindex,
                          ovalue AS ovalue,
                          oscript AS oscript,
                          oheight AS oheight
                        FROM
                          history
                        WHERE
                          address = ANY($1) AND
                          itxid IS NULL AND
                          (oheight > $2 OR iheight > $2 OR oheight IS NULL)`,
      spent: `SELECT
                itxid AS itxid,
                iheight AS iheight
              FROM
                history
              WHERE
                otxid = $1 AND
                oindex = $2`,
      dependUnconfirmedTxIds: `SELECT
                                 itxid AS txid
                               FROM
                                 history
                               WHERE
                                 itxid IS NOT NULL AND
                                 iheight IS NULL AND
                                 otxid = ANY($1)`
    },
    ccScannedTxIds: {
      latestBlock: `SELECT
                      blockhash AS blockhash,
                      height AS height
                    FROM
                      cc_scanned_txids
                    WHERE
                      height IS NOT NULL
                    ORDER BY
                      height DESC
                    LIMIT 1`,
      blockHash: `SELECT
                    blockhash AS blockhash,
                    height AS height
                  FROM
                    cc_scanned_txids
                  WHERE
                    height = $1
                  LIMIT 1`,
      isTxScanned: `SELECT EXISTS (SELECT
                                     true
                                   FROM
                                     cc_scanned_txids
                                   WHERE
                                     txid = $1)`,
      unconfirmed: `SELECT
                      txid AS txid
                    FROM
                      cc_scanned_txids
                    WHERE
                      height IS NULL`
    },
    ccDefinitions: {
      colorId: `SELECT
                  id AS id
                FROM
                  cclib_definitions
                WHERE
                  cdesc ~ $1`
    },
    ccData: {
      coinsByDesc: `SELECT
                      cclib_data.txid AS txid,
                      cclib_data.oidx AS oidx,
                      cclib_data.value AS value
                    FROM
                      cclib_definitions
                    INNER JOIN
                      cclib_data ON cclib_definitions.id = cclib_data.color_id
                    WHERE
                      cclib_definitions.cdesc = $1`
    }
  },
  update: {
    transactions: {
      makeConfirmed: `UPDATE
                        transactions
                      SET
                        height = $1
                      WHERE
                        txid = $2`,
      makeUnconfirmed: `UPDATE
                          transactions
                        SET
                          height = NULL
                        WHERE
                          height > $1`
    },
    history: {
      addConfirmedInput: `UPDATE
                            history
                          SET
                            itxid = $1,
                            iheight = $2
                          WHERE
                            otxid = $3 AND
                            oindex = $4
                          RETURNING
                            address`,
      addUnconfirmedInput: `UPDATE
                              history
                            SET
                              itxid = $1
                            WHERE
                              otxid = $2 AND
                              oindex = $3
                            RETURNING
                              address`,
      makeOutputConfirmed: `UPDATE
                              history
                            SET
                              oheight = $1
                            WHERE
                              otxid = $2
                            RETURNING
                              address`,
      makeOutputsUnconfirmed: `UPDATE
                                 history
                               SET
                                 oheight = NULL
                               WHERE
                                 oheight > $1`,
      makeInputConfirmed: `UPDATE
                             history
                           SET
                             iheight = $1
                           WHERE
                             otxid = $2 AND
                             oindex = $3
                           RETURNING
                             address`,
      makeInputsUnconfirmed: `UPDATE
                                history
                              SET
                                iheight = NULL
                              WHERE
                                iheight > $1`,
      deleteUnconfirmedInputsByTxIds: `UPDATE
                                         history
                                       SET
                                         itxid = NULL
                                       WHERE
                                         iheight IS NULL AND
                                         itxid = ANY($1)`
    },
    ccScannedTxIds: {
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
    }
  },
  delete: {
    blocks: {
      fromHeight: `DELETE FROM blocks WHERE height > $1`
    },
    transactions: {
      unconfirmedByTxIds: `DELETE FROM
                             transactions
                           WHERE
                             height IS NULL AND
                             txid = ANY($1) RETURNING txid`
    },
    history: {
      unconfirmedByTxIds: `DELETE FROM
                             history
                           WHERE
                             oheight IS NULL AND
                             otxid = ANY($1)`
    },
    newTx: {
      byId: `DELETE FROM new_txs WHERE id = $1 RETURNING tx`
    },
    ccScannedTxIds: {
      byTxId: `DELETE FROM cc_scanned_txids WHERE txid = $1`
    }
  }
}
