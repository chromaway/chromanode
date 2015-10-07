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
         hex BYTEA NOT NULL)`,
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
      valueByKey: `SELECT value FROM info WHERE key = $1`
    }
  }
}
